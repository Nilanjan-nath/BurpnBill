import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

// No network, no database: db and supabase are fakes.

const SESSION = {
  live: '11111111-1111-4111-8111-111111111111',
  expired: '22222222-2222-4222-8222-222222222222',
  closedTable: '33333333-3333-4333-8333-333333333333',
};
const STAFF_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNLINKED_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const fakeDb = {
  async query(text, params) {
    if (text.includes('from public.guest_sessions')) {
      const row = { table_id: 't1', restaurant_id: 'r1', live: true, ordering_open: true };
      if (params[0] === SESSION.live) return { rows: [row] };
      if (params[0] === SESSION.expired) return { rows: [{ ...row, live: false }] };
      if (params[0] === SESSION.closedTable) return { rows: [{ ...row, ordering_open: false }] };
      return { rows: [] };
    }
    if (text.includes('from public.staff_members')) {
      if (params[0] === STAFF_USER) return { rows: [{ restaurant_id: 'r1', role: 'staff', display_name: 'Ravi' }] };
      if (params[0] === OWNER_USER) return { rows: [{ restaurant_id: 'r1', role: 'owner', display_name: 'Mita' }] };
      return { rows: [] };
    }
    return { rows: [] };
  },
};

// Tokens are just the user id, prefixed.
const fakeSupabase = {
  auth: {
    async getUser(token) {
      const id = token.startsWith('valid-') ? token.slice(6) : null;
      return id ? { data: { user: { id } }, error: null } : { data: null, error: new Error('bad jwt') };
    },
  },
};

let server;
let base;

before(async () => {
  const app = createApp({
    config: { appBaseUrl: 'http://localhost:5173' },
    db: fakeDb,
    supabase: fakeSupabase,
    checks: { database: async () => {}, supabase: async () => { throw new Error('down'); } },
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  return { status: res.status, body: await res.json() };
}

const asUser = (id) => ({ Authorization: `Bearer valid-${id}` });

test('GET /health is always ok', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});

test('GET /health/ready reports each dependency and fails if any is down', async () => {
  const res = await call('GET', '/health/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.checks.database, 'ok');
  assert.match(res.body.checks.supabase, /down/);
});

test('unknown routes get a JSON 404', async () => {
  const res = await call('GET', '/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'not_found');
});

test('malformed JSON is a 400, not a 500', async () => {
  const res = await call('POST', '/api/orders', {
    headers: { 'X-Guest-Session': SESSION.live },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'bad_request');
});

test('menu route is public: an unknown QR token is a 404, not a login wall', async () => {
  const res = await call('GET', '/api/menu/some-qr-token');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'not_found');
});

test('cart and order routes need a guest session', async () => {
  for (const [method, path] of [['GET', '/api/cart'], ['POST', '/api/cart/items'], ['POST', '/api/orders']]) {
    const res = await call(method, path);
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal(res.body.error.code, 'guest_session_missing');
  }
});

test('guest session: malformed, unknown, expired, closed table, live', async () => {
  const cases = [
    ['not-a-uuid', 401, 'guest_session_missing'],
    ['99999999-9999-4999-8999-999999999999', 401, 'guest_session_invalid'],
    [SESSION.expired, 401, 'guest_session_expired'],
    [SESSION.closedTable, 403, 'ordering_unavailable'],
  ];
  for (const [session, status, code] of cases) {
    const res = await call('GET', '/api/cart', { headers: { 'X-Guest-Session': session } });
    assert.equal(res.status, status, session);
    assert.equal(res.body.error.code, code, session);
  }

  // A live session gets through: an empty cart, not an error.
  const live = await call('GET', '/api/cart', { headers: { 'X-Guest-Session': SESSION.live } });
  assert.equal(live.status, 200);
  assert.equal(live.body.cart_id, null);
});

test('staff routes reject missing and invalid tokens', async () => {
  assert.equal((await call('GET', '/api/orders')).status, 401);
  assert.equal((await call('GET', '/api/orders', { headers: { Authorization: 'Bearer junk' } })).status, 401);
});

test('a signed-in user with no restaurant link is forbidden', async () => {
  const res = await call('GET', '/api/me', { headers: asUser(UNLINKED_USER) });
  assert.equal(res.status, 403);
});

test('GET /api/me returns the staff member and their restaurant', async () => {
  const res = await call('GET', '/api/me', { headers: asUser(STAFF_USER) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.staff, { userId: STAFF_USER, restaurantId: 'r1', role: 'staff', displayName: 'Ravi' });
});

test('owner-only routes: staff get 403, owner reaches the stub', async () => {
  assert.equal((await call('POST', '/api/items', { headers: asUser(STAFF_USER), body: '{}' })).status, 403);
  assert.equal((await call('POST', '/api/items', { headers: asUser(OWNER_USER), body: '{}' })).status, 501);
});

test('staff can work the board and 86 items', async () => {
  const opts = { headers: asUser(STAFF_USER), body: '{}' };
  assert.equal((await call('GET', '/api/orders', { headers: asUser(STAFF_USER) })).status, 200); // built in step 4, slice 1
  assert.equal((await call('PATCH', '/api/orders/x/status', opts)).status, 400); // 'x' is not a uuid — built in slice 1
  assert.equal((await call('PATCH', '/api/items/x/availability', opts)).status, 501);
});
