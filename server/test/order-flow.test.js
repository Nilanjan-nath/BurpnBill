import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// The whole public flow against a real Postgres (PGlite) with the repo's real
// migrations and seed: SQL, transactions, locks, triggers and constraints all
// run for real. Only Supabase Auth is faked, and this flow doesn't use it.

let db;
let server;
let base;
let tokens; // table label -> qr_token

before(async () => {
  db = await createTestDb();
  const app = createApp({
    config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 },
    db,
    supabase: {},
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;

  const { rows } = await db.query('select label, qr_token from restaurant_tables');
  tokens = Object.fromEntries(rows.map((r) => [r.label, r.qr_token]));
});

after(async () => {
  server.close();
  await db.close();
});

async function api(method, path, { session, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session && { 'X-Guest-Session': session }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// A fresh guest at a table: scans the QR code, gets a session.
async function scan(table = 'T1', existingSession) {
  const res = await api('GET', `/api/menu/${tokens[table]}`, { session: existingSession });
  assert.equal(res.status, 200);
  return { session: res.body.session.id, menu: res.body };
}

const itemId = async (name) =>
  (await db.query('select id from menu_items where name = $1 and restaurant_id = $2', [name, RESTAURANT_ID])).rows[0].id;

const add = (session, menu_item_id, quantity = 1, special_instructions) =>
  api('POST', '/api/cart/items', { session, body: { menu_item_id, quantity, special_instructions } });

const orderCount = async () => (await db.query('select count(*)::int n from orders')).rows[0].n;

// --- menu & sessions --------------------------------------------------------

test('menu: grouped by category, only live items, with a guest session', async () => {
  const { menu } = await scan('T2');
  assert.equal(menu.restaurant.name, 'Chai Point Cafe');
  assert.equal(menu.table.label, 'T2');
  assert.deepEqual(menu.categories.map((c) => c.name), ['Beverages', 'Desserts', 'Mains', 'Snacks']);
  assert.equal(menu.categories.flatMap((c) => c.items).length, 12);
  assert.deepEqual(menu.categories[0].items.map((i) => i.name), ['Masala Chai', 'Filter Coffee', 'Cold Coffee', 'Fresh Lime Soda']);
  assert.equal(menu.categories[0].items[0].price, '30.00');
  assert.ok(menu.session.id && menu.session.expires_at);
});

test('menu: 86d and deleted items never appear', async () => {
  await db.query("update menu_items set is_available = false where name = 'Cold Coffee'");
  await db.query("update menu_items set deleted_at = now() where name = 'Fresh Lime Soda'");
  try {
    const { menu } = await scan();
    const names = menu.categories.flatMap((c) => c.items.map((i) => i.name));
    assert.ok(!names.includes('Cold Coffee') && !names.includes('Fresh Lime Soda'));
    assert.equal(names.length, 10);
  } finally {
    await db.query("update menu_items set is_available = true, deleted_at = null where name in ('Cold Coffee', 'Fresh Lime Soda')");
  }
});

test('menu: unknown QR token is 404; inactive table or cafe is 403', async () => {
  assert.equal((await api('GET', '/api/menu/does-not-exist')).status, 404);

  await db.query("update restaurant_tables set is_active = false where label = 'T4'");
  const closedTable = await api('GET', `/api/menu/${tokens.T4}`);
  assert.equal(closedTable.status, 403);
  assert.equal(closedTable.body.error.code, 'ordering_unavailable');
  await db.query("update restaurant_tables set is_active = true where label = 'T4'");

  await db.query('update restaurants set is_active = false');
  assert.equal((await api('GET', `/api/menu/${tokens.T1}`)).status, 403);
  await db.query('update restaurants set is_active = true');
});

test('sessions: reused for the same table while live, replaced otherwise', async () => {
  const { session } = await scan('T1');

  assert.equal((await scan('T1', session)).session, session, 'same table, still live -> reused');
  assert.notEqual((await scan('T2', session)).session, session, 'another table -> new session');

  await db.query("update guest_sessions set expires_at = now() - interval '1 minute' where id = $1", [session]);
  assert.notEqual((await scan('T1', session)).session, session, 'expired -> new session');

  assert.notEqual((await scan('T1')).session, session, 'no header -> new session');
});

// --- cart -------------------------------------------------------------------

test('cart: starts empty, add merges same item + same notes, splits on different notes', async () => {
  const { session } = await scan();
  const chai = await itemId('Masala Chai');

  const empty = await api('GET', '/api/cart', { session });
  assert.deepEqual(empty.body, { cart_id: null, items: [], subtotal: '0.00', has_unavailable_items: false });

  assert.equal((await add(session, chai, 1)).status, 201);
  assert.equal((await add(session, chai, 2, '')).body.items.length, 1, 'blank note == no note -> merged');
  const res = await add(session, chai, 1, '  less sugar  ');

  assert.equal(res.body.items.length, 2, 'different notes -> separate line');
  const [plain, noted] = res.body.items;
  assert.equal(plain.quantity, 3);
  assert.equal(plain.special_instructions, null);
  assert.equal(noted.special_instructions, 'less sugar', 'note is trimmed');
  assert.equal(res.body.subtotal, '120.00'); // 4 x 30.00, computed by the server
  assert.equal(plain.line_total, '90.00');

  assert.equal((await api('GET', '/api/cart', { session })).body.cart_id, res.body.cart_id, 'one cart per session');
});

test('cart: input validation', async () => {
  const { session } = await scan();
  const chai = await itemId('Masala Chai');
  const bad = async (body) => {
    const res = await api('POST', '/api/cart/items', { session, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'bad_request');
    assert.ok(res.body.error.issues.length);
  };
  await bad({ menu_item_id: chai, quantity: 0 });
  await bad({ menu_item_id: chai, quantity: 100 });
  await bad({ menu_item_id: chai, quantity: 1.5 });
  await bad({ menu_item_id: chai, quantity: '2' });
  await bad({ menu_item_id: 'not-a-uuid', quantity: 1 });
  await bad({ menu_item_id: chai, quantity: 1, special_instructions: 'x'.repeat(281) });
  await bad({ menu_item_id: chai, quantity: 1, price: '0.01' }); // the client never sends prices
  await bad({});

  assert.equal((await add(session, chai, 60)).status, 201);
  const overflow = await add(session, chai, 40);
  assert.equal(overflow.status, 400, 'merging past 99 is rejected');
  assert.equal((await api('GET', '/api/cart', { session })).body.items[0].quantity, 60, 'and changes nothing');
});

test('cart: items that are 86d, deleted, or from another cafe are refused', async () => {
  const { session } = await scan();
  const tea = await itemId('Filter Coffee');

  await db.query('update menu_items set is_available = false where id = $1', [tea]);
  const off = await add(session, tea);
  assert.equal(off.status, 409);
  assert.equal(off.body.error.code, 'item_unavailable');
  await db.query('update menu_items set is_available = true, deleted_at = now() where id = $1', [tea]);
  assert.equal((await add(session, tea)).status, 409);
  await db.query('update menu_items set deleted_at = null where id = $1', [tea]);

  const { rows: other } = await db.query(
    `with r as (insert into restaurants (name) values ('Other Cafe') returning id)
     insert into menu_items (restaurant_id, name, price) select id, 'Secret Special', 1 from r returning id`,
  );
  const forged = await add(session, other[0].id);
  assert.equal(forged.status, 404, "another cafe's item id can't be added");

  assert.equal((await api('GET', '/api/cart', { session })).body.cart_id, null, 'no cart was left behind');
});

test('cart: update and remove only touch lines in the session\'s own cart', async () => {
  const mine = await scan();
  const theirs = await scan();
  const chai = await itemId('Masala Chai');
  const line = (await add(mine.session, chai, 2)).body.items[0];
  await add(theirs.session, chai, 1);

  const patched = await api('PATCH', `/api/cart/items/${line.id}`, { session: mine.session, body: { quantity: 5, special_instructions: 'extra hot' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.items[0].quantity, 5);
  assert.equal(patched.body.items[0].special_instructions, 'extra hot');

  const noteOnly = await api('PATCH', `/api/cart/items/${line.id}`, { session: mine.session, body: { special_instructions: null } });
  assert.equal(noteOnly.body.items[0].quantity, 5, 'quantity untouched');
  assert.equal(noteOnly.body.items[0].special_instructions, null, 'note cleared');

  assert.equal((await api('PATCH', `/api/cart/items/${line.id}`, { session: mine.session, body: {} })).status, 400);
  assert.equal((await api('PATCH', `/api/cart/items/${line.id}`, { session: theirs.session, body: { quantity: 9 } })).status, 404);
  assert.equal((await api('DELETE', `/api/cart/items/${line.id}`, { session: theirs.session })).status, 404);

  const removed = await api('DELETE', `/api/cart/items/${line.id}`, { session: mine.session });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.items, []);
  assert.equal(removed.body.subtotal, '0.00');
});

test('cart: has_unavailable_items flags lines 86d after they were added', async () => {
  const { session } = await scan();
  const coffee = await itemId('Filter Coffee');
  await add(session, coffee);
  await db.query('update menu_items set is_available = false where id = $1', [coffee]);
  try {
    const cart = (await api('GET', '/api/cart', { session })).body;
    assert.equal(cart.has_unavailable_items, true);
    assert.equal(cart.items[0].available, false);
  } finally {
    await db.query('update menu_items set is_available = true where id = $1', [coffee]);
  }
});

// --- placing an order ---------------------------------------------------------

test('order: created from the cart with server-side prices snapshotted', async () => {
  const { session } = await scan('T3');
  const chai = await itemId('Masala Chai');
  const roll = await itemId('Paneer Tikka Roll');
  await add(session, chai, 2, 'less sugar');
  const cart = (await add(session, roll, 1)).body;

  const before = await orderCount();
  const res = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
  assert.equal(res.status, 201);
  const { order } = res.body;

  assert.equal(order.status, 'placed');
  assert.equal(order.table_label, 'T3');
  assert.ok(order.order_number >= 1001);
  assert.equal(order.subtotal, '200.00'); // 2 x 30 + 140
  assert.equal(order.total_amount, '200.00');
  assert.equal(order.items.length, 2);
  const chaiLine = order.items.find((i) => i.name === 'Masala Chai');
  assert.deepEqual(
    { price: chaiLine.price, quantity: chaiLine.quantity, note: chaiLine.special_instructions, total: chaiLine.line_total },
    { price: '30.00', quantity: 2, note: 'less sugar', total: '60.00' },
  );
  assert.equal(await orderCount(), before + 1);

  const { rows: events } = await db.query('select from_status, to_status from order_status_events where order_id = $1', [order.id]);
  assert.deepEqual(events, [{ from_status: null, to_status: 'placed' }], 'creation is in the status log');

  // The cart is spent; the next add starts a fresh one.
  assert.equal((await api('GET', '/api/cart', { session })).body.cart_id, null);
  assert.notEqual((await add(session, chai)).body.cart_id, cart.cart_id);
});

test('order: a retried or double-tapped request returns the same order, never a duplicate', async () => {
  const { session } = await scan();
  await add(session, await itemId('Masala Chai'));
  const { cart_id } = (await api('GET', '/api/cart', { session })).body;

  const before = await orderCount();
  const first = await api('POST', '/api/orders', { session, body: { cart_id } });
  const retry = await api('POST', '/api/orders', { session, body: { cart_id } });
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.order.id, first.body.order.id);
  assert.equal(retry.body.order.order_number, first.body.order.order_number);
  assert.equal(await orderCount(), before + 1);
});

test('order: simultaneous requests for one cart produce one order', async () => {
  const { session } = await scan();
  await add(session, await itemId('Samosa (2 pcs)'), 2);
  const { cart_id } = (await api('GET', '/api/cart', { session })).body;

  const before = await orderCount();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => api('POST', '/api/orders', { session, body: { cart_id } })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 201]);
  assert.equal(new Set(results.map((r) => r.body.order.id)).size, 1);
  assert.equal(await orderCount(), before + 1);
});

test('order: the database itself refuses a second order from one cart', async () => {
  const { session } = await scan();
  await add(session, await itemId('Masala Chai'));
  const { cart_id } = (await api('GET', '/api/cart', { session })).body;
  const { order } = (await api('POST', '/api/orders', { session, body: { cart_id } })).body;

  const { rows } = await db.query('select restaurant_id, table_id, guest_session_id from orders where id = $1', [order.id]);
  await assert.rejects(
    db.query('insert into orders (restaurant_id, table_id, guest_session_id, cart_id) values ($1, $2, $3, $4)', [
      rows[0].restaurant_id, rows[0].table_id, rows[0].guest_session_id, cart_id,
    ]),
    /orders_one_per_cart_idx|unique/i,
  );
});

test('order: an empty cart cannot be ordered', async () => {
  const { session } = await scan();
  const line = (await add(session, await itemId('Masala Chai'))).body;
  const { cart_id } = (await api('DELETE', `/api/cart/items/${line.items[0].id}`, { session })).body;

  const before = await orderCount();
  const res = await api('POST', '/api/orders', { session, body: { cart_id } });
  assert.equal(res.status, 400);
  assert.equal(await orderCount(), before);
});

test('order: items 86d or deleted since they were added block checkout and write nothing', async () => {
  const { session } = await scan();
  const chai = await itemId('Masala Chai');
  const brownie = await itemId('Chocolate Brownie');
  const puff = await itemId('Chicken Puff');
  await add(session, chai);
  await add(session, brownie);
  const cart = (await add(session, puff)).body;

  await db.query('update menu_items set is_available = false where id = $1', [brownie]);
  await db.query('update menu_items set deleted_at = now() where id = $1', [puff]);
  try {
    const before = await orderCount();
    const res = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'items_unavailable');
    assert.deepEqual(res.body.error.unavailable_items.map((i) => i.name).sort(), ['Chicken Puff', 'Chocolate Brownie']);
    assert.equal(await orderCount(), before, 'no order was created');
    assert.equal((await api('GET', '/api/cart', { session })).body.items.length, 3, 'cart untouched');

    // Customer removes the two lines and confirms again.
    for (const line of res.body.error.unavailable_items) {
      await api('DELETE', `/api/cart/items/${line.cart_item_id}`, { session });
    }
    const retry = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
    assert.equal(retry.status, 201);
    assert.deepEqual(retry.body.order.items.map((i) => i.name), ['Masala Chai']);
  } finally {
    await db.query('update menu_items set is_available = true, deleted_at = null where id in ($1, $2)', [brownie, puff]);
  }
});

test('order: uses the price at checkout, and later menu edits never change it', async () => {
  const { session } = await scan();
  const chai = await itemId('Masala Chai');
  const cart = (await add(session, chai, 2)).body;

  await db.query("update menu_items set price = 35 where id = $1", [chai]); // repriced after adding
  try {
    const { order } = (await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } })).body;
    assert.equal(order.subtotal, '70.00');
    assert.equal(order.items[0].price, '35.00');

    await db.query("update menu_items set price = 50, name = 'Kadak Chai' where id = $1", [chai]);
    const { rows } = await db.query('select name_at_order, price_at_order from order_items where order_id = $1', [order.id]);
    assert.deepEqual(rows, [{ name_at_order: 'Masala Chai', price_at_order: '35.00' }]);
  } finally {
    await db.query("update menu_items set price = 30, name = 'Masala Chai' where id = $1", [chai]);
  }
});

test('order: another session\'s cart, or a made-up one, is 404; bad bodies are 400', async () => {
  const a = await scan();
  const b = await scan();
  const cart = (await add(a.session, await itemId('Masala Chai'))).body;

  assert.equal((await api('POST', '/api/orders', { session: b.session, body: { cart_id: cart.cart_id } })).status, 404);
  assert.equal((await api('POST', '/api/orders', { session: a.session, body: { cart_id: '99999999-9999-9999-9999-999999999999' } })).status, 404);
  assert.equal((await api('POST', '/api/orders', { session: a.session, body: {} })).status, 400);
  assert.equal((await api('POST', '/api/orders', { session: a.session, body: { cart_id: cart.cart_id, total: 1 } })).status, 400);
});

test('order: two guests at the same table get two independent orders', async () => {
  const one = await scan('T4');
  const two = await scan('T4');
  const chai = await itemId('Masala Chai');

  const cartOne = (await add(one.session, chai)).body;
  const cartTwo = (await add(two.session, chai, 3)).body;
  assert.notEqual(cartOne.cart_id, cartTwo.cart_id);

  const orderOne = (await api('POST', '/api/orders', { session: one.session, body: { cart_id: cartOne.cart_id } })).body.order;
  const orderTwo = (await api('POST', '/api/orders', { session: two.session, body: { cart_id: cartTwo.cart_id } })).body.order;
  assert.notEqual(orderOne.id, orderTwo.id);
  assert.equal(orderOne.subtotal, '30.00');
  assert.equal(orderTwo.subtotal, '90.00');
  assert.equal(orderOne.table_label, 'T4');
  assert.equal(orderTwo.table_label, 'T4');
});

test('order: an expired session cannot place an order', async () => {
  const { session } = await scan();
  const cart = (await add(session, await itemId('Masala Chai'))).body;
  await db.query("update guest_sessions set expires_at = now() - interval '1 minute' where id = $1", [session]);

  const res = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'guest_session_expired');
});
