import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// Owner menu management — GET/POST/PATCH/DELETE /items and the availability
// toggle — on real Postgres (PGlite) with the repo's migrations and seed.

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CAFE_OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

  const { rows } = await db.query(`insert into restaurants (name) values ('Other Cafe') returning id`);
  otherRestaurantId = rows[0].id;
  await db.query(`insert into menu_items (restaurant_id, name, price, category) values ($1, 'Rival Chai', 20, 'Beverages')`, [otherRestaurantId]);

  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $3, 'owner', 'Mita'), ($2, $3, 'staff', 'Ravi'), ($4, $5, 'owner', 'Rival')`,
    [OWNER, STAFF, RESTAURANT_ID, OTHER_CAFE_OWNER, otherRestaurantId],
  );
});

after(async () => {
  server.close();
  await db.close();
});

async function call(method, path, { as, session, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as && { Authorization: `Bearer valid-${as}` }),
      ...(session && { 'X-Guest-Session': session }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const listItems = (as) => call('GET', '/api/items', { as });
const findByName = (items, name) => items.find((i) => i.name === name);

// --- GET /items --------------------------------------------------------------

test('needs a signed-in staff member; a café only ever sees its own items', async () => {
  assert.equal((await call('GET', '/api/items')).status, 401);
  const ours = (await listItems(STAFF)).body.items;
  const theirs = (await listItems(OTHER_CAFE_OWNER)).body.items;
  assert.ok(ours.some((i) => i.name === 'Masala Chai'));
  assert.ok(!ours.some((i) => i.name === 'Rival Chai'));
  assert.deepEqual(theirs.map((i) => i.name), ['Rival Chai']);
});

test('the admin list includes 86\'d items (unlike the public menu), never deleted ones', async () => {
  const { rows } = await db.query(`select id from menu_items where restaurant_id = $1 and name = 'Filter Coffee'`, [RESTAURANT_ID]);
  await db.query('update menu_items set is_available = false where id = $1', [rows[0].id]);
  try {
    const items = (await listItems(STAFF)).body.items;
    const coffee = findByName(items, 'Filter Coffee');
    assert.ok(coffee, 'still listed, just flagged');
    assert.equal(coffee.is_available, false);
  } finally {
    await db.query('update menu_items set is_available = true where id = $1', [rows[0].id]);
  }
});

// --- POST /items ---------------------------------------------------------------

test('creating an item is owner only, and validates the input', async () => {
  assert.equal((await call('POST', '/api/items', { as: STAFF, body: { name: 'x', price: 1 } })).status, 403);

  for (const body of [{}, { name: 'No price' }, { price: 10 }, { name: '', price: 10 }, { name: 'x', price: -1 }, { name: 'x'.repeat(201), price: 1 }]) {
    const res = await call('POST', '/api/items', { as: OWNER, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('a created item appears in the admin list with sane defaults, available by default', async () => {
  const res = await call('POST', '/api/items', { as: OWNER, body: { name: 'Ginger Tea', price: 25 } });
  assert.equal(res.status, 201);
  assert.equal(res.body.item.name, 'Ginger Tea');
  assert.equal(res.body.item.price, '25.00');
  assert.equal(res.body.item.category, 'Uncategorised');
  assert.equal(res.body.item.is_available, true);
  assert.equal(res.body.item.is_veg, null);

  const items = (await listItems(OWNER)).body.items;
  assert.ok(findByName(items, 'Ginger Tea'));
});

test('a new item is on the real customer menu immediately', async () => {
  await call('POST', '/api/items', { as: OWNER, body: { name: 'Rose Lassi', price: 60, category: 'Beverages', is_veg: true } });
  const menu = await call('GET', `/api/menu/${tokens.T1}`);
  const item = menu.body.categories.flatMap((c) => c.items).find((i) => i.name === 'Rose Lassi');
  assert.ok(item, 'shows up without any extra step');
  assert.equal(item.price, '60.00');
});

// --- PATCH /items/:id -----------------------------------------------------------

test('editing is owner only; unknown id, another café\'s item, and an empty body are all rejected', async () => {
  const { rows } = await db.query(`select id from menu_items where restaurant_id = $1 and name = 'Masala Chai'`, [RESTAURANT_ID]);
  const chaiId = rows[0].id;

  assert.equal((await call('PATCH', `/api/items/${chaiId}`, { as: STAFF, body: { price: 35 } })).status, 403);
  assert.equal((await call('PATCH', '/api/items/99999999-9999-4999-8999-999999999999', { as: OWNER, body: { price: 35 } })).status, 404);
  const { rows: theirs } = await db.query(`select id from menu_items where restaurant_id = $1`, [otherRestaurantId]);
  assert.equal((await call('PATCH', `/api/items/${theirs[0].id}`, { as: OWNER, body: { price: 35 } })).status, 404);
  assert.equal((await call('PATCH', `/api/items/${chaiId}`, { as: OWNER, body: {} })).status, 400);
});

test('only the sent fields change; a field left out keeps its value, sent as null clears it', async () => {
  const created = (await call('POST', '/api/items', { as: OWNER, body: { name: 'Mixed Sandwich', description: 'cheese and veg', price: 70, is_veg: true } })).body.item;

  const priceOnly = await call('PATCH', `/api/items/${created.id}`, { as: OWNER, body: { price: 75 } });
  assert.equal(priceOnly.body.item.price, '75.00');
  assert.equal(priceOnly.body.item.description, 'cheese and veg', 'untouched');
  assert.equal(priceOnly.body.item.is_veg, true, 'untouched');

  const cleared = await call('PATCH', `/api/items/${created.id}`, { as: OWNER, body: { description: null, is_veg: null } });
  assert.equal(cleared.body.item.description, null);
  assert.equal(cleared.body.item.is_veg, null);
  assert.equal(cleared.body.item.price, '75.00', 'still untouched');
});

test('a price or name edit reaches the customer menu, but never rewrites a past order', async () => {
  const menu = await call('GET', `/api/menu/${tokens.T2}`);
  const session = menu.body.session.id;
  const chai = menu.body.categories.flatMap((c) => c.items).find((i) => i.name === 'Masala Chai');
  await call('POST', '/api/cart/items', { session, body: { menu_item_id: chai.id, quantity: 1 } });
  const cart = (await call('GET', '/api/cart', { session })).body;
  const order = (await call('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } })).body.order;
  assert.equal(order.items[0].price, '30.00');

  await call('PATCH', `/api/items/${chai.id}`, { as: OWNER, body: { name: 'Kadak Chai', price: 45 } });
  try {
    const refreshedMenu = await call('GET', `/api/menu/${tokens.T2}`);
    assert.equal(refreshedMenu.body.categories.flatMap((c) => c.items).find((i) => i.id === chai.id).name, 'Kadak Chai');

    const { rows } = await db.query('select name_at_order, price_at_order from order_items where order_id = $1', [order.id]);
    assert.deepEqual(rows, [{ name_at_order: 'Masala Chai', price_at_order: '30.00' }]);
  } finally {
    await db.query(`update menu_items set name = 'Masala Chai', price = 30 where id = $1`, [chai.id]);
  }
});

// --- DELETE /items/:id -----------------------------------------------------------

test('deleting is owner only, soft, idempotent-safe, and never breaks past orders', async () => {
  const created = (await call('POST', '/api/items', { as: OWNER, body: { name: 'Seasonal Special', price: 99 } })).body.item;

  const menu = await call('GET', `/api/menu/${tokens.T3}`);
  const session = menu.body.session.id;
  await call('POST', '/api/cart/items', { session, body: { menu_item_id: created.id, quantity: 1 } });
  const cart = (await call('GET', '/api/cart', { session })).body;
  const order = (await call('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } })).body.order;

  assert.equal((await call('DELETE', `/api/items/${created.id}`, { as: STAFF })).status, 403);
  const del = await call('DELETE', `/api/items/${created.id}`, { as: OWNER });
  assert.equal(del.status, 204);

  const items = (await listItems(OWNER)).body.items;
  assert.ok(!findByName(items, 'Seasonal Special'), 'gone from the admin list too, not just the public menu');

  const menuAfter = await call('GET', `/api/menu/${tokens.T3}`);
  assert.ok(!menuAfter.body.categories.flatMap((c) => c.items).some((i) => i.id === created.id));

  const { rows } = await db.query('select name_at_order from order_items where order_id = $1', [order.id]);
  assert.deepEqual(rows, [{ name_at_order: 'Seasonal Special' }], 'the order still remembers it');

  assert.equal((await call('DELETE', `/api/items/${created.id}`, { as: OWNER })).status, 404, 'deleting twice is a 404, not a crash');
});

test('deleting another café\'s item, or one that never existed, is 404', async () => {
  const { rows } = await db.query(`select id from menu_items where restaurant_id = $1`, [otherRestaurantId]);
  assert.equal((await call('DELETE', `/api/items/${rows[0].id}`, { as: OWNER })).status, 404);
  assert.equal((await call('DELETE', '/api/items/99999999-9999-4999-8999-999999999999', { as: OWNER })).status, 404);
});

// --- PATCH /items/:id/availability ------------------------------------------------

test('staff AND owner can 86 an item, and it disappears from ordering immediately', async () => {
  const { rows } = await db.query(`select id from menu_items where restaurant_id = $1 and name = 'Samosa (2 pcs)'`, [RESTAURANT_ID]);
  const itemId = rows[0].id;

  const off = await call('PATCH', `/api/items/${itemId}/availability`, { as: STAFF, body: { is_available: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.item.is_available, false);

  try {
    const menu = await call('GET', `/api/menu/${tokens.T4}`);
    assert.ok(!menu.body.categories.flatMap((c) => c.items).some((i) => i.id === itemId), 'gone from the public menu');

    const cartAttempt = await call('POST', '/api/cart/items', { session: menu.body.session.id, body: { menu_item_id: itemId, quantity: 1 } });
    assert.equal(cartAttempt.status, 409, 'and cannot be added to a cart while 86\'d');

    const on = await call('PATCH', `/api/items/${itemId}/availability`, { as: OWNER, body: { is_available: true } });
    assert.equal(on.body.item.is_available, true);
  } finally {
    await db.query('update menu_items set is_available = true where id = $1', [itemId]);
  }
});

test('availability needs a real boolean, a real item in your own café', async () => {
  const { rows } = await db.query(`select id from menu_items where restaurant_id = $1 and name = 'Masala Chai'`, [RESTAURANT_ID]);
  assert.equal((await call('PATCH', `/api/items/${rows[0].id}/availability`, { as: STAFF, body: { is_available: 'nope' } })).status, 400);
  assert.equal((await call('PATCH', `/api/items/${rows[0].id}/availability`, { as: STAFF, body: {} })).status, 400);
  assert.equal((await call('PATCH', '/api/items/not-a-uuid/availability', { as: STAFF, body: { is_available: false } })).status, 400);

  const { rows: theirs } = await db.query(`select id from menu_items where restaurant_id = $1`, [otherRestaurantId]);
  assert.equal((await call('PATCH', `/api/items/${theirs[0].id}/availability`, { as: STAFF, body: { is_available: false } })).status, 404);
});
