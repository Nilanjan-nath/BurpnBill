import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createTestDb } from './helpers/testDb.js';

// The limiters against the real app on a real Postgres (PGlite). Each test
// builds its own app with tiny limits, because a limiter's counters live in
// the app that made it. Limits are counted before authentication on purpose:
// a flood of bad requests is exactly what must not reach the database.

let db;
let token; // a real table's qr_token
const servers = [];

// Mute the one-line-per-block log the limiter writes.
const realWarn = console.warn;
before(async () => {
  console.warn = () => {};
  db = await createTestDb();
  token = (await db.query("select qr_token from restaurant_tables where label = 'T1'")).rows[0].qr_token;
});
after(async () => {
  console.warn = realWarn;
  servers.forEach((s) => s.close());
  await db.close();
});

async function start({ rateLimit, trustProxy = 'loopback' } = {}) {
  const app = createApp({
    config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3, rateLimit, trustProxy },
    db,
    supabase: {},
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  servers.push(server);
  const base = `http://localhost:${server.address().port}`;
  return (method, path, { session, ip, body } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(session && { 'X-Guest-Session': session }),
        ...(ip && { 'X-Forwarded-For': ip }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const statuses = async (calls) => (await Promise.all(calls)).map((r) => r.status);
const sequentially = async (n, fn) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push((await fn(i)).status);
  return out;
};

test('orders: a guest session is blocked after its limit, with a Retry-After and the usual error shape', async () => {
  const call = await start({ rateLimit: { orderPerMinute: 3 } });
  const session = randomUUID();
  // The session does not exist, so these are 401s — and they still count.
  const codes = await sequentially(3, () => call('POST', '/api/orders', { session, body: {} }));
  assert.deepEqual(codes, [401, 401, 401]);

  const blocked = await call('POST', '/api/orders', { session, body: {} });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'Retry-After tells the client when to come back');
  const body = await blocked.json();
  assert.equal(body.error.code, 'rate_limited');
  assert.match(body.error.message, /wait/i);
});

test('two diners on one wifi do not share a bucket: a busy session never blocks another', async () => {
  const call = await start({ rateLimit: { orderPerMinute: 2 } });
  const a = randomUUID();
  const b = randomUUID();
  await sequentially(2, () => call('POST', '/api/orders', { session: a, body: {} }));
  assert.equal((await call('POST', '/api/orders', { session: a, body: {} })).status, 429);
  // Same ip, different session: still allowed through to the real check.
  assert.equal((await call('POST', '/api/orders', { session: b, body: {} })).status, 401);
});

test('a table of six on one wifi is never blocked by ordinary use', async () => {
  const call = await start({ rateLimit: { ipPerMinute: 60, statusPerMinute: 20 } });
  const sessions = Array.from({ length: 6 }, () => randomUUID());
  // Each phone polls status five times: 30 requests from one ip, 5 per session.
  const codes = await statuses(sessions.flatMap((s) => Array.from({ length: 5 }, () => call('GET', '/api/orders/status', { session: s }))));
  assert.ok(codes.every((c) => c === 401), `no 429 expected, got ${[...new Set(codes)]}`);
});

test('inventing a fresh session id per request does not dodge the limit: the per-ip backstop catches it', async () => {
  const call = await start({ rateLimit: { ipPerMinute: 5 } });
  const codes = await sequentially(8, () => call('GET', '/api/orders/status', { session: randomUUID() }));
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429, 429]);
});

test('the per-ip backstop is shared across every public route', async () => {
  const call = await start({ rateLimit: { ipPerMinute: 4 } });
  const codes = [
    (await call('GET', `/api/menu/${token}`)).status,
    (await call('GET', '/api/cart')).status,
    (await call('GET', '/api/bill')).status,
    (await call('GET', `/api/receipts/${'a'.repeat(32)}`)).status,
    (await call('GET', `/api/menu/${token}`)).status,
  ];
  assert.deepEqual(codes, [200, 401, 401, 404, 429]);
});

test('menu: limited per ip, and a different visitor is unaffected', async () => {
  const call = await start({ rateLimit: { menuPerMinute: 2 } });
  assert.deepEqual(await sequentially(3, () => call('GET', `/api/menu/${token}`, { ip: '203.0.113.7' })), [200, 200, 429]);
  assert.equal((await call('GET', `/api/menu/${token}`, { ip: '198.51.100.9' })).status, 200);
});

test('receipts: limited per ip', async () => {
  const call = await start({ rateLimit: { receiptsPerMinute: 2 } });
  const path = `/api/receipts/${'b'.repeat(32)}`;
  assert.deepEqual(await sequentially(3, () => call('GET', path)), [404, 404, 429]);
});

test('create-a-cafe: a handful per ip per hour, counted before sign-in is checked', async () => {
  const call = await start({ rateLimit: { createCafePerHour: 2 } });
  assert.deepEqual(await sequentially(3, () => call('POST', '/api/restaurants', { body: {} })), [401, 401, 429]);
});

test('the forwarded address is believed only when the proxy is trusted', async () => {
  const trusted = await start({ rateLimit: { menuPerMinute: 2 }, trustProxy: 'loopback' });
  const codes = await sequentially(3, (i) => trusted('GET', `/api/menu/${token}`, { ip: `203.0.113.${i + 1}` }));
  assert.deepEqual(codes, [200, 200, 200], 'three different visitors, three different buckets');

  // Nothing trusted: a header anyone can write must not buy a fresh bucket.
  const untrusted = await start({ rateLimit: { menuPerMinute: 2 }, trustProxy: false });
  const spoofed = await sequentially(3, (i) => untrusted('GET', `/api/menu/${token}`, { ip: `203.0.113.${i + 1}` }));
  assert.deepEqual(spoofed, [200, 200, 429]);
});

test('health checks are never limited: the uptime monitor must always get an answer', async () => {
  const call = await start({ rateLimit: { ipPerMinute: 1, menuPerMinute: 1 } });
  const codes = await statuses(Array.from({ length: 10 }, () => call('GET', '/health')));
  assert.ok(codes.every((c) => c === 200));
});

test('with no rate limit configured nothing is limited', async () => {
  const call = await start({ rateLimit: undefined });
  const codes = await statuses(Array.from({ length: 40 }, () => call('GET', `/api/menu/${token}`)));
  assert.ok(codes.every((c) => c === 200));
});

test('the shipped defaults leave a busy cafe plenty of room', async () => {
  const call = await start({ rateLimit: {} });
  // 40 phones on one wifi, each polling status 4 times: 160 requests, one ip.
  const sessions = Array.from({ length: 40 }, () => randomUUID());
  const codes = await statuses(sessions.flatMap((s) => Array.from({ length: 4 }, () => call('GET', '/api/orders/status', { session: s }))));
  assert.ok(codes.every((c) => c === 401), `no 429 expected, got ${[...new Set(codes)]}`);
});
