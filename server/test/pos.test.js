import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// GET /floor and POST /staff/orders (step 7, POS) — on real Postgres (PGlite)
// with the repo's migrations and seed (4 tables T1-T4, all free to start).

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CAFE_OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db;
let server;
let base;
let otherRestaurantId;
let otherTableId;

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

  const { rows } = await db.query(`insert into restaurants (name) values ('Other Cafe') returning id`);
  otherRestaurantId = rows[0].id;
  const { rows: table } = await db.query(
    `insert into restaurant_tables (restaurant_id, label) values ($1, 'X1') returning id`,
    [otherRestaurantId],
  );
  otherTableId = table[0].id;

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

async function call(method, path, { as, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as && { Authorization: `Bearer valid-${as}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function tableId(label, restaurantId = RESTAURANT_ID) {
  const { rows } = await db.query('select id from restaurant_tables where label = $1 and restaurant_id = $2', [label, restaurantId]);
  return rows[0].id;
}
async function itemId(name, restaurantId = RESTAURANT_ID) {
  const { rows } = await db.query('select id from menu_items where name = $1 and restaurant_id = $2', [name, restaurantId]);
  return rows[0].id;
}

const floor = (as) => call('GET', '/api/floor', { as });
const placeStaffOrder = (as, body) => call('POST', '/api/staff/orders', { as, body });

// --- GET /floor --------------------------------------------------------------

test('needs a signed-in staff member; owner only, staff gets 403', async () => {
  assert.equal((await call('GET', '/api/floor')).status, 401);
  assert.equal((await floor(STAFF)).status, 403);
  assert.equal((await floor(OWNER)).status, 200);
});

test('every seeded table starts free', async () => {
  const res = await floor(OWNER);
  assert.equal(res.status, 200);
  const t1 = res.body.tables.find((t) => t.label === 'T1');
  assert.equal(t1.status, 'free');
  assert.equal(t1.active_order, null);
});

test('a table with an active order shows occupied, with that order\'s id/number/status', async () => {
  const t2 = await tableId('T2');
  const chai = await itemId('Masala Chai');
  const created = await placeStaffOrder(OWNER, { table_id: t2, items: [{ menu_item_id: chai, quantity: 1 }] });
  assert.equal(created.status, 201);

  const res = await floor(OWNER);
  const row = res.body.tables.find((t) => t.label === 'T2');
  assert.equal(row.status, 'occupied');
  assert.equal(row.active_order.id, created.body.order.id);
  assert.equal(row.active_order.order_number, created.body.order.order_number);
  assert.equal(row.active_order.status, 'placed');

  await db.query(`update orders set status = 'cancelled' where id = $1`, [created.body.order.id]);
  const after2 = (await floor(OWNER)).body.tables.find((t) => t.label === 'T2');
  assert.equal(after2.status, 'free', 'a cancelled order no longer occupies the table');
});

test('a table stays occupied through "served" — the group is still there until checkout, not just until the kitchen is done', async () => {
  const t2 = await tableId('T2');
  const chai = await itemId('Masala Chai');
  const created = await placeStaffOrder(OWNER, { table_id: t2, items: [{ menu_item_id: chai, quantity: 1 }] });
  for (const status of ['preparing', 'ready', 'served']) {
    await db.query(`update orders set status = $2 where id = $1`, [created.body.order.id, status]);
  }

  const row = (await floor(OWNER)).body.tables.find((t) => t.label === 'T2');
  assert.equal(row.status, 'occupied', 'served is not the same as checked out');
  assert.equal(row.active_order.status, 'served');
});

test('a café only ever sees its own floor', async () => {
  const res = await floor(OWNER);
  assert.ok(!res.body.tables.some((t) => t.label === 'X1'));

  const theirs = await call('GET', '/api/floor', { as: OTHER_CAFE_OWNER });
  assert.deepEqual(theirs.body.tables.map((t) => t.label), ['X1']);
});

// --- POST /staff/orders --------------------------------------------------------

test('needs a signed-in staff member; owner only, staff gets 403', async () => {
  const t3 = await tableId('T3');
  const chai = await itemId('Masala Chai');
  const body = { table_id: t3, items: [{ menu_item_id: chai, quantity: 1 }] };

  assert.equal((await call('POST', '/api/staff/orders', { body })).status, 401);
  assert.equal((await placeStaffOrder(STAFF, body)).status, 403);
});

test('validates the body: a real table, at least one item, sane quantities', async () => {
  const t3 = await tableId('T3');
  const chai = await itemId('Masala Chai');

  for (const body of [
    {},
    { table_id: t3 },
    { table_id: t3, items: [] },
    { table_id: 'not-a-uuid', items: [{ menu_item_id: chai, quantity: 1 }] },
    { table_id: t3, items: [{ menu_item_id: chai, quantity: 0 }] },
    { table_id: t3, items: [{ menu_item_id: chai, quantity: 100 }] },
    { table_id: t3, items: [{ menu_item_id: 'not-a-uuid', quantity: 1 }] },
  ]) {
    const res = await placeStaffOrder(OWNER, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('places a real order: price/name snapshotted, total summed in SQL, matches the kitchen board', async () => {
  const t1 = await tableId('T1');
  const chai = await itemId('Masala Chai'); // 30.00
  const samosa = await itemId('Samosa (2 pcs)'); // 40.00

  const res = await placeStaffOrder(OWNER, {
    table_id: t1,
    items: [
      { menu_item_id: chai, quantity: 2, special_instructions: 'less sugar' },
      { menu_item_id: samosa, quantity: 1 },
    ],
  });
  assert.equal(res.status, 201);
  const order = res.body.order;
  assert.equal(order.table.label, 'T1');
  assert.equal(order.status, 'placed');
  assert.equal(order.total_amount, '100.00'); // 2 x 30 + 40
  assert.deepEqual(order.items, [
    { name: 'Masala Chai', price: '30.00', quantity: 2, special_instructions: 'less sugar', line_total: '60.00' },
    { name: 'Samosa (2 pcs)', price: '40.00', quantity: 1, special_instructions: null, line_total: '40.00' },
  ]);

  // Shows up on the live kitchen board exactly like a QR order would.
  const board = await call('GET', '/api/orders', { as: OWNER });
  assert.ok(board.body.orders.some((o) => o.id === order.id));
});

test('the timeline records the owner who placed it, unlike a customer QR order', async () => {
  const t2 = await tableId('T2');
  const chai = await itemId('Masala Chai');
  const created = await placeStaffOrder(OWNER, { table_id: t2, items: [{ menu_item_id: chai, quantity: 1 }] });

  const detail = await call('GET', `/api/orders/${created.body.order.id}`, { as: OWNER });
  assert.deepEqual(
    detail.body.order.timeline.map(({ from_status, to_status, changed_by }) => ({ from_status, to_status, changed_by })),
    [{ from_status: null, to_status: 'placed', changed_by: 'Mita' }],
  );
});

test('a made-up or inactive table is 404, not a crash', async () => {
  const chai = await itemId('Masala Chai');
  const madeUp = await placeStaffOrder(OWNER, {
    table_id: '99999999-9999-4999-8999-999999999999',
    items: [{ menu_item_id: chai, quantity: 1 }],
  });
  assert.equal(madeUp.status, 404);

  const t4 = await tableId('T4');
  await db.query('update restaurant_tables set is_active = false where id = $1', [t4]);
  const inactive = await placeStaffOrder(OWNER, { table_id: t4, items: [{ menu_item_id: chai, quantity: 1 }] });
  assert.equal(inactive.status, 404);
  await db.query('update restaurant_tables set is_active = true where id = $1', [t4]);
});

test('another café\'s table is 404, and their menu items can\'t be ordered onto your table', async () => {
  const t1 = await tableId('T1');
  await db.query(`insert into menu_items (restaurant_id, name, price, category) values ($1, 'Rival Chai', 20, 'Beverages')`, [otherRestaurantId]);
  const rivalChai = await itemId('Rival Chai', otherRestaurantId);
  const chai = await itemId('Masala Chai');

  const theirTable = await placeStaffOrder(OWNER, { table_id: otherTableId, items: [{ menu_item_id: chai, quantity: 1 }] });
  assert.equal(theirTable.status, 404);

  const theirItem = await placeStaffOrder(OWNER, { table_id: t1, items: [{ menu_item_id: rivalChai, quantity: 1 }] });
  assert.equal(theirItem.status, 404);
});

test('an 86\'d or deleted item is rejected, and nothing is written', async () => {
  const t3 = await tableId('T3');
  const chai = await itemId('Masala Chai');
  const coffee = await itemId('Filter Coffee');
  await db.query('update menu_items set is_available = false where id = $1', [coffee]);

  const res = await placeStaffOrder(OWNER, {
    table_id: t3,
    items: [{ menu_item_id: chai, quantity: 1 }, { menu_item_id: coffee, quantity: 1 }],
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'items_unavailable');
  assert.deepEqual(res.body.error.unavailable_items, [{ menu_item_id: coffee, name: 'Filter Coffee' }]);

  const board = await call('GET', '/api/orders', { as: OWNER });
  const t3Orders = board.body.orders.filter((o) => o.table.label === 'T3');
  assert.equal(t3Orders.length, 0, 'the whole request rolled back — no partial order for the chai');

  await db.query('update menu_items set is_available = true where id = $1', [coffee]);
});

// --- POST /tables/:tableId/checkout --------------------------------------------

const checkout = (as, tableId) => call('POST', `/api/tables/${tableId}/checkout`, { as });

test('checkout needs a signed-in staff member; owner only, staff gets 403', async () => {
  const t1 = await tableId('T1');
  assert.equal((await call('POST', `/api/tables/${t1}/checkout`)).status, 401);
  assert.equal((await checkout(STAFF, t1)).status, 403);
});

test('checkout frees the table even after the order was served, not just while it was active', async () => {
  const t4 = await tableId('T4');
  const chai = await itemId('Masala Chai');
  const created = await placeStaffOrder(OWNER, { table_id: t4, items: [{ menu_item_id: chai, quantity: 1 }] });
  for (const status of ['preparing', 'ready', 'served']) {
    await db.query(`update orders set status = $2 where id = $1`, [created.body.order.id, status]);
  }
  assert.equal((await floor(OWNER)).body.tables.find((t) => t.label === 'T4').status, 'occupied');

  const res = await checkout(OWNER, t4);
  assert.equal(res.status, 204);

  const row = (await floor(OWNER)).body.tables.find((t) => t.label === 'T4');
  assert.equal(row.status, 'free');
  assert.equal(row.active_order, null);

  const { rows } = await db.query('select paid_at from orders where id = $1', [created.body.order.id]);
  assert.ok(rows[0].paid_at, 'the order itself is marked paid, not just hidden from the floor');
});

test('checkout leaves a still-active (non-served, non-cancelled) order alone — it stays occupied', async () => {
  const t1 = await tableId('T1');
  const chai = await itemId('Masala Chai');
  const created = await placeStaffOrder(OWNER, { table_id: t1, items: [{ menu_item_id: chai, quantity: 1 }] });

  await checkout(OWNER, t1);

  const row = (await floor(OWNER)).body.tables.find((t) => t.label === 'T1');
  assert.equal(row.status, 'occupied', 'checkout should not silently mark an in-progress order paid');
  assert.equal(row.active_order.id, created.body.order.id);

  await db.query(`update orders set status = 'cancelled' where id = $1`, [created.body.order.id]);
});

test('a made-up or another café\'s table is 404', async () => {
  assert.equal((await checkout(OWNER, '99999999-9999-4999-8999-999999999999')).status, 404);
  assert.equal((await checkout(OWNER, otherTableId)).status, 404);
});
