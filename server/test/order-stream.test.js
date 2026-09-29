import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createOrderEventHub } from '../src/orderStream.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// GET /orders/stream — SSE push to the live staff dashboard. Real Postgres
// (PGlite), a real open HTTP connection read as it streams (the same way the
// dashboard itself will read it, via fetch — not EventSource, see staff.js),
// and real orders placed/moved through the actual customer and staff APIs.

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CAFE_STAFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db;
let server;
let base;
let hub;
let tokens;
let otherRestaurantId;

before(async () => {
  db = await createTestDb();
  hub = createOrderEventHub({ heartbeatMs: 30 }); // fast on purpose — only this test file waits on heartbeats
  const supabase = {
    auth: {
      async getUser(token) {
        return token.startsWith('valid-')
          ? { data: { user: { id: token.slice(6) } }, error: null }
          : { data: null, error: new Error('bad token') };
      },
    },
  };
  const app = createApp({ config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 }, db, supabase, hub });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;

  tokens = Object.fromEntries((await db.query('select label, qr_token from restaurant_tables')).rows.map((r) => [r.label, r.qr_token]));

  // A second café, so isolation can be tested for real.
  const { rows } = await db.query(`insert into restaurants (name) values ('Other Cafe') returning id`);
  otherRestaurantId = rows[0].id;
  const { rows: table } = await db.query(
    `insert into restaurant_tables (restaurant_id, label) values ($1, 'X1') returning qr_token`,
    [otherRestaurantId],
  );
  tokens.X1 = table[0].qr_token;
  await db.query(`insert into menu_items (restaurant_id, name, price) values ($1, 'Rival Chai', 20)`, [otherRestaurantId]);
  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $3, 'owner', 'Mita'), ($2, $3, 'staff', 'Ravi'), ($4, $5, 'owner', 'Rival')`,
    [OWNER, STAFF, RESTAURANT_ID, OTHER_CAFE_STAFF, otherRestaurantId],
  );
});

after(async () => {
  hub.closeAll();
  server.close();
  await db.close();
});

async function api(method, path, { as, session, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as && { Authorization: `Bearer valid-${as}` }),
      ...(session && { 'X-Guest-Session': session }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function place(table, items, restaurantId = RESTAURANT_ID) {
  const menu = (await api('GET', `/api/menu/${tokens[table]}`)).body;
  const session = menu.session.id;
  for (const { name, quantity = 1, note } of items) {
    const { rows } = await db.query('select id from menu_items where name = $1 and restaurant_id = $2', [name, restaurantId]);
    const res = await api('POST', '/api/cart/items', { session, body: { menu_item_id: rows[0].id, quantity, special_instructions: note } });
    assert.equal(res.status, 201);
  }
  const cart = (await api('GET', '/api/cart', { session })).body;
  const res = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
  assert.equal(res.status, 201);
  return res.body.order;
}

// Opens the stream exactly the way the real dashboard will: fetch + an
// Authorization header, reading the body as it arrives rather than waiting
// for it to finish (it never does). Splits on the blank line that ends every
// SSE frame; comment lines (heartbeats, the opening "connected" ping) are
// kept separately from real named events.
function openStream(as) {
  const controller = new AbortController();
  const frames = [];
  const comments = [];

  const opened = fetch(`${base}/api/orders/stream`, {
    headers: { Authorization: `Bearer valid-${as}` },
    signal: controller.signal,
  }).then((res) => {
    if (res.ok && res.body) pump(res.body.getReader());
    return res;
  });

  async function pump(reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (raw.startsWith(':')) {
            comments.push(raw);
            continue;
          }
          const event = raw.match(/^event: (.+)$/m)?.[1] ?? 'message';
          const data = raw.match(/^data: (.+)$/m)?.[1];
          if (data) frames.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {
      // Reading throws once close() aborts the underlying fetch — expected.
    }
  }

  return { frames, comments, opened, close: () => controller.abort() };
}

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test('the stream needs a signed-in staff member', async () => {
  assert.equal((await fetch(`${base}/api/orders/stream`)).status, 401);
});

test('opens with an immediate frame, then heartbeats keep it alive', async () => {
  const stream = openStream(STAFF);
  const res = await stream.opened;
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');

  await waitFor(() => stream.comments.length >= 1); // the opening ": connected"
  await waitFor(() => stream.comments.length >= 3, { timeoutMs: 1000 }); // a couple of 30ms heartbeats too
  stream.close();
});

test('a QR order pushes qr_order_pending — the approval queue, not the kitchen', async () => {
  const stream = openStream(STAFF);
  await stream.opened;
  await waitFor(() => stream.comments.length >= 1); // don't act until the stream is actually open

  const order = await place('T1', [{ name: 'Masala Chai', quantity: 2, note: 'less sugar' }]);

  await waitFor(() => stream.frames.some((f) => f.event === 'qr_order_pending'));
  const frame = stream.frames.find((f) => f.event === 'qr_order_pending');
  assert.ok(
    !stream.frames.some((f) => f.event === 'order_created'),
    'the kitchen must not hear about a QR order until staff accept it',
  );
  assert.equal(frame.data.id, order.id);
  assert.equal(frame.data.order_number, order.order_number);
  assert.equal(frame.data.status, 'placed');
  assert.equal(frame.data.table.label, 'T1');
  assert.deepEqual(frame.data.items, [{ name: 'Masala Chai', quantity: 2, special_instructions: 'less sugar' }]);

  stream.close();
});

test('a retried order (same cart, already converted) never pushes a second event', async () => {
  const stream = openStream(STAFF);
  await stream.opened;
  await waitFor(() => stream.comments.length >= 1);

  const menu = (await api('GET', `/api/menu/${tokens.T2}`)).body;
  const session = menu.session.id;
  const { rows } = await db.query('select id from menu_items where name = $1', ['Masala Chai']);
  await api('POST', '/api/cart/items', { session, body: { menu_item_id: rows[0].id, quantity: 1 } });
  const cart = (await api('GET', '/api/cart', { session })).body;

  const first = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
  assert.equal(first.status, 201);
  await waitFor(() => stream.frames.filter((f) => f.event === 'qr_order_pending').length === 1);

  const retry = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
  assert.equal(retry.status, 200); // the idempotent "already exists" path, not a new order

  await new Promise((resolve) => setTimeout(resolve, 150)); // give a wrongly-duplicated event time to arrive
  assert.equal(stream.frames.filter((f) => f.event === 'qr_order_pending').length, 1, 'still exactly one event');

  stream.close();
});

test('approving a queued order is what finally pushes order_created to the kitchen', async () => {
  const stream = openStream(STAFF);
  await stream.opened;
  await waitFor(() => stream.comments.length >= 1);

  const order = await place('T3', [{ name: 'Masala Chai', quantity: 1 }]);
  await waitFor(() => stream.frames.some((f) => f.event === 'qr_order_pending'));

  const res = await api('POST', `/api/orders/${order.id}/approve`, { as: STAFF });
  assert.equal(res.status, 200);

  await waitFor(() => stream.frames.some((f) => f.event === 'order_created'));
  const frame = stream.frames.find((f) => f.event === 'order_created');
  assert.equal(frame.data.id, order.id);
  assert.equal(frame.data.status, 'placed');

  stream.close();
});

test('moving an order pushes order_status_changed with its new status', async () => {
  const order = await place('T3', [{ name: 'Masala Chai' }]);
  // Accepted first: an order the counter hasn't accepted can't be moved at all.
  // Done before the stream opens so it is this test's move, not the approval,
  // whose event is being waited for.
  assert.equal((await api('POST', `/api/orders/${order.id}/approve`, { as: STAFF })).status, 200);
  const stream = openStream(OWNER);
  await stream.opened;
  await waitFor(() => stream.comments.length >= 1);

  const res = await api('PATCH', `/api/orders/${order.id}/status`, { as: STAFF, body: { status: 'preparing' } });
  assert.equal(res.status, 200);

  await waitFor(() => stream.frames.some((f) => f.event === 'order_status_changed'));
  const frame = stream.frames.find((f) => f.event === 'order_status_changed');
  assert.equal(frame.data.id, order.id);
  assert.equal(frame.data.status, 'preparing');

  stream.close();
});

test('a rejected (illegal / lost-race) move never pushes an event', async () => {
  const order = await place('T4', [{ name: 'Masala Chai' }]);
  const stream = openStream(STAFF);
  await stream.opened;
  await waitFor(() => stream.comments.length >= 1);

  const res = await api('PATCH', `/api/orders/${order.id}/status`, { as: STAFF, body: { status: 'served' } }); // placed -> served: illegal
  assert.equal(res.status, 409);

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(stream.frames.length, 0);

  stream.close();
});

test('a café only ever hears about its own orders', async () => {
  const ours = openStream(STAFF);
  const theirs = openStream(OTHER_CAFE_STAFF);
  await Promise.all([ours.opened, theirs.opened]);
  await waitFor(() => ours.comments.length >= 1 && theirs.comments.length >= 1);

  const ourOrder = await place('T1', [{ name: 'Masala Chai' }]);
  const theirOrder = await place('X1', [{ name: 'Rival Chai' }], otherRestaurantId);

  await waitFor(() => ours.frames.some((f) => f.data.id === ourOrder.id));
  await waitFor(() => theirs.frames.some((f) => f.data.id === theirOrder.id));

  assert.ok(!ours.frames.some((f) => f.data.id === theirOrder.id), "another café's order never reaches our stream");
  assert.ok(!theirs.frames.some((f) => f.data.id === ourOrder.id));

  ours.close();
  theirs.close();
});

test('a closed connection is actually removed from the hub, not just left to fail silently', async () => {
  const stream = openStream(STAFF);
  await stream.opened;
  await waitFor(() => stream.comments.length >= 1);
  assert.equal(hub.connectionCount(RESTAURANT_ID), 1);

  stream.close();
  await waitFor(() => hub.connectionCount(RESTAURANT_ID) === 0); // proves cleanup ran, not just "nothing crashed"

  // And with it gone, a later publish that would have tried to write to it
  // doesn't error or hang the request that triggered it.
  const order = await place('T2', [{ name: 'Masala Chai' }]);
  assert.ok(order.id);
});
