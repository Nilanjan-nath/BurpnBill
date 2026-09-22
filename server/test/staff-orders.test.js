import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// GET /orders — the kitchen board's initial load — on a real Postgres (PGlite)
// with the repo's migrations and seed. Orders are placed through the real
// customer API; only Supabase Auth is faked (a token is just "valid-<user id>").

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOT_LINKED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_CAFE_STAFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db;
let server;
let base;
let tokens;
let otherRestaurantId;

before(async () => {
  db = await createTestDb();
  const supabase = {
    auth: {
      async getUser(token) {
        return token.startsWith('valid-')
          ? { data: { user: { id: token.slice(6) } }, error: null }
          : { data: null, error: new Error('bad token') };
      },
    },
  };
  const app = createApp({ config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 }, db, supabase });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;

  tokens = Object.fromEntries((await db.query('select label, qr_token from restaurant_tables')).rows.map((r) => [r.label, r.qr_token]));

  // A second café with its own staff member, table and menu.
  const { rows } = await db.query(`insert into restaurants (name) values ('Other Cafe') returning id`);
  otherRestaurantId = rows[0].id;
  const { rows: table } = await db.query(
    `insert into restaurant_tables (restaurant_id, label) values ($1, 'X1') returning qr_token`,
    [otherRestaurantId],
  );
  tokens.X1 = table[0].qr_token;
  await db.query(`insert into menu_items (restaurant_id, name, price, category) values ($1, 'Rival Chai', 20, 'Beverages')`, [otherRestaurantId]);

  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $3, 'owner', 'Mita'), ($2, $3, 'staff', 'Ravi'), ($4, $5, 'owner', 'Rival')`,
    [OWNER, STAFF, RESTAURANT_ID, OTHER_CAFE_STAFF, otherRestaurantId],
  );
});

after(async () => {
  server.close();
  await db.close();
});

async function call(method, path, { as, authorization, session, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as && { Authorization: `Bearer valid-${as}` }),
      ...(authorization && { Authorization: authorization }),
      ...(session && { 'X-Guest-Session': session }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// A customer at a table places an order through the real API.
async function place(table, items, restaurantId = RESTAURANT_ID) {
  const menu = (await call('GET', `/api/menu/${tokens[table]}`)).body;
  const session = menu.session.id;
  for (const { name, quantity = 1, note } of items) {
    const { rows } = await db.query('select id from menu_items where name = $1 and restaurant_id = $2', [name, restaurantId]);
    const res = await call('POST', '/api/cart/items', {
      session,
      body: { menu_item_id: rows[0].id, quantity, special_instructions: note },
    });
    assert.equal(res.status, 201);
  }
  const cart = (await call('GET', '/api/cart', { session })).body;
  const res = await call('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
  assert.equal(res.status, 201);
  return res.body.order;
}

const setStatus = (orderId, status) => db.query('update orders set status = $2 where id = $1', [orderId, status]);
const list = (as, query = '') => call('GET', `/api/orders${query}`, { as });
const numbers = (res) => res.body.orders.map((o) => o.order_number);

test('needs a signed-in staff member linked to a café', async () => {
  assert.equal((await call('GET', '/api/orders')).status, 401);
  assert.equal((await call('GET', '/api/orders', { authorization: 'Bearer junk' })).status, 401);
  assert.equal((await list(NOT_LINKED)).status, 403);
});

test('owner and staff both see the board', async () => {
  assert.equal((await list(OWNER)).status, 200);
  assert.equal((await list(STAFF)).status, 200);
});

test('returns active orders oldest first, with table, lines, notes and totals', async () => {
  const first = await place('T1', [{ name: 'Masala Chai', quantity: 2, note: 'less sugar' }, { name: 'Veg Sandwich' }]);
  const second = await place('T2', [{ name: 'Filter Coffee' }]);

  const res = await list(STAFF);
  assert.equal(res.status, 200);
  const ours = res.body.orders.filter((o) => [first.order_number, second.order_number].includes(o.order_number));
  assert.deepEqual(ours.map((o) => o.order_number), [first.order_number, second.order_number], 'oldest first');

  const [a, b] = ours;
  assert.equal(a.status, 'placed');
  assert.equal(a.table.label, 'T1');
  assert.ok(a.table.id);
  assert.equal(a.total_amount, '140.00'); // 2 x 30 + 80
  assert.deepEqual(a.items, [
    { name: 'Masala Chai', quantity: 2, special_instructions: 'less sugar' },
    { name: 'Veg Sandwich', quantity: 1, special_instructions: null },
  ]);
  assert.equal(b.table.label, 'T2');
  assert.ok(!('subtotal' in a) && !('tax_amount' in a), 'kitchen cards carry the total only');
});

test('server_time is included so ages can be measured on the server\'s clock', async () => {
  const res = await list(STAFF);
  const skew = Math.abs(Date.now() - Date.parse(res.body.server_time));
  assert.ok(!Number.isNaN(skew) && skew < 5000);
});

test('only orders that still need work: served and cancelled are left out', async () => {
  const active = await place('T3', [{ name: 'Maggi Masala' }]);
  const served = await place('T3', [{ name: 'Maggi Masala' }]);
  const cancelled = await place('T3', [{ name: 'Maggi Masala' }]);
  for (const s of ['preparing', 'ready', 'served']) await setStatus(served.id, s);
  await setStatus(cancelled.id, 'cancelled');

  const got = numbers(await list(STAFF));
  assert.ok(got.includes(active.order_number));
  assert.ok(!got.includes(served.order_number));
  assert.ok(!got.includes(cancelled.order_number));
});

test('status_changed_at is when the order entered its CURRENT status', async () => {
  const order = await place('T1', [{ name: 'Masala Chai' }]);
  const beforeMove = (await list(STAFF)).body.orders.find((o) => o.id === order.id);
  assert.equal(beforeMove.status_changed_at, beforeMove.placed_at, 'never moved: same as placed_at');

  await setStatus(order.id, 'preparing');
  // A realistic timeline: placed 10 minutes ago, moved to preparing 7 minutes ago.
  await db.query(
    `update order_status_events
        set created_at = now() - (case to_status when 'placed' then interval '10 minutes' else interval '7 minutes' end)
      where order_id = $1`,
    [order.id],
  );
  const { rows } = await db.query(`select created_at from order_status_events where order_id = $1 and to_status = 'preparing'`, [order.id]);

  const moved = (await list(STAFF)).body.orders.find((o) => o.id === order.id);
  assert.equal(moved.status, 'preparing');
  assert.equal(Date.parse(moved.status_changed_at), rows[0].created_at.getTime());
});

test('a café only ever sees its own orders', async () => {
  const mine = await place('T1', [{ name: 'Masala Chai' }]);
  const theirs = await place('X1', [{ name: 'Rival Chai' }], otherRestaurantId);

  const seenByUs = numbers(await list(OWNER));
  assert.ok(seenByUs.includes(mine.order_number));
  assert.ok(!seenByUs.includes(theirs.order_number), "another café's order never appears");

  const seenByThem = numbers(await list(OTHER_CAFE_STAFF));
  assert.deepEqual(seenByThem, [theirs.order_number]);

  // Passing their table id doesn't unlock it either.
  const { rows } = await db.query(`select id from restaurant_tables where label = 'X1'`);
  const forged = await list(OWNER, `?table_id=${rows[0].id}`);
  assert.equal(forged.status, 200);
  assert.deepEqual(forged.body.orders, []);
});

test('filters: by status and by table', async () => {
  const cooking = await place('T4', [{ name: 'Veg Fried Rice' }]);
  const waiting = await place('T4', [{ name: 'Veg Fried Rice' }]);
  await setStatus(cooking.id, 'preparing');

  const preparing = numbers(await list(STAFF, '?status=preparing'));
  assert.ok(preparing.includes(cooking.order_number));
  assert.ok(!preparing.includes(waiting.order_number));

  const { rows } = await db.query(`select id from restaurant_tables where label = 'T4' and restaurant_id = $1`, [RESTAURANT_ID]);
  const atT4 = (await list(STAFF, `?table_id=${rows[0].id}`)).body.orders;
  assert.ok(atT4.length >= 2);
  assert.ok(atT4.every((o) => o.table.label === 'T4'));
});

test('bad filters are a clear 400, not an empty board', async () => {
  for (const query of ['?status=served', '?status=cancelled', '?status=nonsense', '?table_id=not-a-uuid', '?colour=red', '?status=placed&status=ready']) {
    const res = await list(STAFF, query);
    assert.equal(res.status, 400, query);
    assert.equal(res.body.error.code, 'bad_request');
    assert.ok(res.body.error.issues.length, query);
  }
});

test('an empty board is an empty list, not an error', async () => {
  await db.query(`update orders set status = 'cancelled' where restaurant_id = $1 and status = 'placed'`, [otherRestaurantId]);
  const res = await list(OTHER_CAFE_STAFF);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.orders, []);
});

// --- GET /orders/:id --------------------------------------------------------

const detail = (as, orderId) => call('GET', `/api/orders/${orderId}`, { as });

test('order detail needs a signed-in staff member linked to a café', async () => {
  const order = await place('T1', [{ name: 'Masala Chai' }]);
  assert.equal((await call('GET', `/api/orders/${order.id}`)).status, 401);
  assert.equal((await detail(NOT_LINKED, order.id)).status, 403);
});

test('returns the order with its items, table and totals', async () => {
  const order = await place('T2', [{ name: 'Masala Chai', quantity: 2, note: 'less sugar' }, { name: 'Samosa (2 pcs)' }]);

  const res = await detail(STAFF, order.id);
  assert.equal(res.status, 200);
  const got = res.body.order;
  assert.equal(got.order_number, order.order_number);
  assert.equal(got.status, 'placed');
  assert.equal(got.table.label, 'T2');
  assert.equal(got.subtotal, '100.00'); // 2 x 30 + 40
  assert.equal(got.total_amount, '100.00');
  assert.deepEqual(got.items, [
    { name: 'Masala Chai', price: '30.00', quantity: 2, special_instructions: 'less sugar', line_total: '60.00' },
    { name: 'Samosa (2 pcs)', price: '40.00', quantity: 1, special_instructions: null, line_total: '40.00' },
  ]);
});

test('a made-up id is 404; a malformed id is 400; another café\'s order is 404, not a peek', async () => {
  const mine = await place('T1', [{ name: 'Masala Chai' }]);
  const theirs = await place('X1', [{ name: 'Rival Chai' }], otherRestaurantId);

  assert.equal((await detail(STAFF, '99999999-9999-4999-8999-999999999999')).status, 404);
  assert.equal((await detail(STAFF, 'not-a-uuid')).status, 400);

  const leaked = await detail(OWNER, theirs.id);
  assert.equal(leaked.status, 404, "another café's order must not be distinguishable from a made-up id");

  assert.equal((await detail(OTHER_CAFE_STAFF, mine.id)).status, 404);
});

test('the timeline starts at placed with no actor (the customer placed it, not staff)', async () => {
  const order = await place('T3', [{ name: 'Masala Chai' }]);
  const { timeline } = (await detail(STAFF, order.id)).body.order;
  assert.deepEqual(timeline, [{ from_status: null, to_status: 'placed', changed_by: null, created_at: timeline[0].created_at }]);
});

test('the timeline records who moved the order and is read oldest first', async () => {
  const order = await place('T4', [{ name: 'Masala Chai' }]);

  // The PATCH /status route (next in this slice) will call db.withTransaction the
  // same way; simulated here to prove the timeline reads an actor correctly.
  await db.withTransaction(
    async (tx) => tx.query(`update orders set status = 'preparing' where id = $1`, [order.id]),
    { actorId: STAFF },
  );
  await db.withTransaction(
    async (tx) => tx.query(`update orders set status = 'ready' where id = $1`, [order.id]),
    { actorId: OWNER },
  );

  const { timeline, status } = (await detail(STAFF, order.id)).body.order;
  assert.equal(status, 'ready');
  assert.deepEqual(
    timeline.map(({ from_status, to_status, changed_by }) => ({ from_status, to_status, changed_by })),
    [
      { from_status: null, to_status: 'placed', changed_by: null },
      { from_status: 'placed', to_status: 'preparing', changed_by: 'Ravi' },
      { from_status: 'preparing', to_status: 'ready', changed_by: 'Mita' },
    ],
  );
  const times = timeline.map((e) => Date.parse(e.created_at));
  assert.ok(times[0] <= times[1] && times[1] <= times[2], 'oldest first');
});

// --- GET /orders/recent ------------------------------------------------------

const recent = (as, query = '') => call('GET', `/api/orders/recent${query}`, { as });
const recentNumbers = (res) => res.body.orders.map((o) => o.order_number);

// Backdates the event that put the order in its CURRENT status — i.e. when it
// finished. Mirrors how the board's status_changed_at is derived: the newest
// row in order_status_events for that order.
async function finishedHoursAgo(orderId, hours) {
  await db.query(
    `update order_status_events set created_at = now() - make_interval(hours => $2)
      where id = (select id from order_status_events where order_id = $1 order by id desc limit 1)`,
    [orderId, hours],
  );
}

test('recent orders needs a signed-in staff member linked to a café', async () => {
  assert.equal((await call('GET', '/api/orders/recent')).status, 401);
  assert.equal((await recent(NOT_LINKED)).status, 403);
});

test('only served and cancelled orders appear, never ones still in progress', async () => {
  const stillPlaced = await place('T1', [{ name: 'Masala Chai' }]);
  const preparing = await place('T1', [{ name: 'Masala Chai' }]);
  await setStatus(preparing.id, 'preparing');
  const served = await place('T1', [{ name: 'Masala Chai' }]);
  for (const s of ['preparing', 'ready', 'served']) await setStatus(served.id, s);
  const cancelled = await place('T1', [{ name: 'Masala Chai' }]);
  await setStatus(cancelled.id, 'cancelled');

  const got = recentNumbers(await recent(STAFF));
  assert.ok(!got.includes(stillPlaced.order_number));
  assert.ok(!got.includes(preparing.order_number));
  assert.ok(got.includes(served.order_number));
  assert.ok(got.includes(cancelled.order_number));

  const servedOrder = (await recent(STAFF)).body.orders.find((o) => o.order_number === served.order_number);
  assert.equal(servedOrder.status, 'served');
  assert.equal(servedOrder.table.label, 'T1');
  assert.deepEqual(servedOrder.items, [{ name: 'Masala Chai', quantity: 1, special_instructions: null }]);
});

test('"recent" means recently FINISHED, not recently placed — a slow order still shows once done', async () => {
  const slow = await place('T2', [{ name: 'Masala Chai' }]);
  // Placed 6 hours ago (outside the default 4h window) but only just served.
  await db.query(`update orders set placed_at = now() - interval '6 hours' where id = $1`, [slow.id]);
  for (const s of ['preparing', 'ready', 'served']) await setStatus(slow.id, s);

  assert.ok(recentNumbers(await recent(STAFF)).includes(slow.order_number));
});

test('orders finished outside the window drop off, and ?hours widens or narrows it', async () => {
  const order = await place('T3', [{ name: 'Masala Chai' }]);
  await setStatus(order.id, 'preparing');
  await setStatus(order.id, 'ready');
  await setStatus(order.id, 'served');
  await finishedHoursAgo(order.id, 10); // served 10 hours ago

  assert.ok(!recentNumbers(await recent(STAFF)).includes(order.order_number), 'outside the default 4h window');
  assert.ok(recentNumbers(await recent(STAFF, '?hours=12')).includes(order.order_number), 'inside a wider window');

  const narrower = await recent(STAFF, '?hours=1');
  assert.ok(!recentNumbers(narrower).includes(order.order_number));
});

test('newest-finished first — the opposite order from the live board', async () => {
  const first = await place('T4', [{ name: 'Masala Chai' }]);
  await setStatus(first.id, 'cancelled');
  const second = await place('T4', [{ name: 'Masala Chai' }]);
  await setStatus(second.id, 'cancelled');

  const ids = recentNumbers(await recent(STAFF)).filter((n) => [first.order_number, second.order_number].includes(n));
  assert.deepEqual(ids, [second.order_number, first.order_number]);
});

test('a café only ever sees its own recent orders', async () => {
  const mine = await place('T1', [{ name: 'Masala Chai' }]);
  await setStatus(mine.id, 'cancelled');
  const theirs = await place('X1', [{ name: 'Rival Chai' }], otherRestaurantId);
  await setStatus(theirs.id, 'cancelled');

  assert.ok(!recentNumbers(await recent(OWNER)).includes(theirs.order_number));
  assert.ok(recentNumbers(await recent(OTHER_CAFE_STAFF)).includes(theirs.order_number));
});

test('bad ?hours is a clear 400', async () => {
  for (const query of ['?hours=0', '?hours=-1', '?hours=2.5', '?hours=abc', '?hours=9999']) {
    const res = await recent(STAFF, query);
    assert.equal(res.status, 400, query);
    assert.equal(res.body.error.code, 'bad_request');
  }
});

// --- PATCH /orders/:id/status -----------------------------------------------

const moveStatus = (as, orderId, status) => call('PATCH', `/api/orders/${orderId}/status`, { as, body: { status } });

test('needs a signed-in staff member; body must name a real target status', async () => {
  const order = await place('T1', [{ name: 'Masala Chai' }]);

  assert.equal((await call('PATCH', `/api/orders/${order.id}/status`, { body: { status: 'preparing' } })).status, 401);
  assert.equal((await moveStatus(NOT_LINKED, order.id, 'preparing')).status, 403);

  for (const body of [{ status: 'placed' }, { status: 'nonsense' }, {}, { status: 'preparing', note: 'x' }]) {
    const res = await call('PATCH', `/api/orders/${order.id}/status`, { as: STAFF, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('each legal move updates the order and logs who made it', async () => {
  const order = await place('T1', [{ name: 'Masala Chai' }]);

  const toPreparing = await moveStatus(STAFF, order.id, 'preparing'); // placed -> preparing
  assert.equal(toPreparing.status, 200);
  assert.equal(toPreparing.body.order.status, 'preparing');

  const toReady = await moveStatus(OWNER, order.id, 'ready'); // preparing -> ready
  assert.equal(toReady.status, 200);
  assert.equal(toReady.body.order.status, 'ready');

  const toServed = await moveStatus(STAFF, order.id, 'served'); // ready -> served
  assert.equal(toServed.status, 200);

  assert.deepEqual(
    toServed.body.order.timeline.map(({ from_status, to_status, changed_by }) => ({ from_status, to_status, changed_by })),
    [
      { from_status: null, to_status: 'placed', changed_by: null },
      { from_status: 'placed', to_status: 'preparing', changed_by: 'Ravi' },
      { from_status: 'preparing', to_status: 'ready', changed_by: 'Mita' },
      { from_status: 'ready', to_status: 'served', changed_by: 'Ravi' },
    ],
  );

  // A served order now shows up in Recent, and drops off the live board.
  assert.ok(!numbers(await list(STAFF)).includes(order.order_number));
  assert.ok(recentNumbers(await recent(STAFF)).includes(order.order_number));
});

test('placed -> cancelled and preparing -> cancelled are both legal', async () => {
  const straightCancel = await place('T2', [{ name: 'Masala Chai' }]);
  assert.equal((await moveStatus(STAFF, straightCancel.id, 'cancelled')).status, 200);

  const cookingCancel = await place('T2', [{ name: 'Masala Chai' }]);
  await moveStatus(STAFF, cookingCancel.id, 'preparing');
  assert.equal((await moveStatus(STAFF, cookingCancel.id, 'cancelled')).status, 200);
});

test('an illegal move is a 409 naming the order\'s real current status', async () => {
  const order = await place('T3', [{ name: 'Masala Chai' }]);

  // placed -> served (skipping preparing/ready) is never legal.
  const res = await moveStatus(STAFF, order.id, 'served');
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'invalid_transition');
  assert.equal(res.body.error.current_status, 'placed');
  assert.equal(res.body.error.changed_by, null); // only the customer's own "placed" event so far
  assert.match(res.body.error.message, /placed/);

  await moveStatus(STAFF, order.id, 'preparing');
  await moveStatus(STAFF, order.id, 'ready');
  await moveStatus(STAFF, order.id, 'served');

  // A served order is terminal: nothing moves it further.
  for (const target of ['preparing', 'ready', 'served', 'cancelled']) {
    const stuck = await moveStatus(STAFF, order.id, target);
    assert.equal(stuck.status, 409, target);
    assert.equal(stuck.body.error.current_status, 'served');
  }
});

test('two staff tapping the same order at once: exactly one wins, the other is told who beat them to it', async () => {
  const order = await place('T4', [{ name: 'Masala Chai' }]);
  await moveStatus(STAFF, order.id, 'preparing'); // both are about to race for the SAME next move

  const [a, b] = await Promise.all([moveStatus(STAFF, order.id, 'ready'), moveStatus(OWNER, order.id, 'ready')]);
  const results = [a, b];
  const winners = results.filter((r) => r.status === 200);
  const losers = results.filter((r) => r.status === 409);

  assert.equal(winners.length, 1, 'the row lock lets exactly one request through');
  assert.equal(losers.length, 1);
  assert.equal(losers[0].body.error.current_status, 'ready');
  assert.ok(['Ravi', 'Mita'].includes(losers[0].body.error.changed_by), 'told who got there first');

  // Only one ready-transition was ever logged — no double-apply, no lost update.
  const { timeline } = (await detail(STAFF, order.id)).body.order;
  assert.equal(timeline.filter((e) => e.to_status === 'ready').length, 1);
});

test('a made-up id, another café\'s order, and a malformed id', async () => {
  const mine = await place('T1', [{ name: 'Masala Chai' }]);
  const theirs = await place('X1', [{ name: 'Rival Chai' }], otherRestaurantId);

  assert.equal((await moveStatus(STAFF, '99999999-9999-4999-8999-999999999999', 'preparing')).status, 404);
  assert.equal((await moveStatus(STAFF, 'not-a-uuid', 'preparing')).status, 400);
  assert.equal((await moveStatus(OWNER, theirs.id, 'preparing')).status, 404, "another café's order is 404, not 403 or 409");
  assert.equal((await moveStatus(OTHER_CAFE_STAFF, mine.id, 'preparing')).status, 404);
});
