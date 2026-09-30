import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// GET /orders/status — what a customer's phone polls while they wait. Real
// Postgres (PGlite) with the repo's own migrations and seed, like the rest.
// Staff-side moves are made straight in SQL: this file is about what the
// CUSTOMER is told, and the state machine's own trigger still runs, so a
// stage can only be reached by a legal sequence.

let db;
let server;
let base;
let tokens;

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

const scan = async (table = 'T1') => (await api('GET', `/api/menu/${tokens[table]}`)).body.session.id;

async function placeOrder(session, itemName = 'Masala Chai') {
  const { rows } = await db.query('select id from menu_items where name = $1 and restaurant_id = $2', [itemName, RESTAURANT_ID]);
  await api('POST', '/api/cart/items', { session, body: { menu_item_id: rows[0].id, quantity: 1 } });
  const cart = (await api('GET', '/api/cart', { session })).body;
  const placed = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
  assert.equal(placed.status, 201);
  return placed.body.order;
}

const stages = async (session) => (await api('GET', '/api/orders/status', { session })).body.orders.map((o) => o.stage);
const setStatus = (id, status) => db.query('update orders set status = $2 where id = $1', [id, status]);

test('an order walks through every stage the customer is told about, in order', async () => {
  const session = await scan('T1');
  const order = await placeOrder(session);

  // The counter hasn't accepted it. This is the state the raw status column
  // cannot express, and the one the customer most needs to hear first.
  assert.deepEqual(await stages(session), ['awaiting']);

  await db.query('update orders set approved_at = now() where id = $1', [order.id]);
  assert.deepEqual(await stages(session), ['accepted']);

  await setStatus(order.id, 'preparing');
  assert.deepEqual(await stages(session), ['preparing']);

  await setStatus(order.id, 'ready');
  assert.deepEqual(await stages(session), ['ready']);

  await setStatus(order.id, 'served');
  assert.deepEqual(await stages(session), ['served']);
});

test('a turned-away order says cancelled, not that it is still waiting', async () => {
  const session = await scan('T2');
  const order = await placeOrder(session);
  await setStatus(order.id, 'cancelled'); // rejected from the queue: never approved

  assert.deepEqual(await stages(session), ['cancelled']);
});

test('the response carries an id, number and time — and no price, item or estimate', async () => {
  const session = await scan('T3');
  const order = await placeOrder(session);
  const { body } = await api('GET', '/api/orders/status', { session });

  assert.deepEqual(Object.keys(body.orders[0]).sort(), ['id', 'order_number', 'placed_at', 'stage']);
  assert.equal(body.orders[0].id, order.id);
  assert.equal(body.orders[0].order_number, order.order_number);
});

test("a guest sees only their own orders — not another guest's at the same table", async () => {
  const mine = await scan('T4');
  const theirs = await scan('T4');
  const myOrder = await placeOrder(mine, 'Masala Chai');
  await placeOrder(theirs, 'Filter Coffee');
  await placeOrder(theirs, 'Cold Coffee');

  const seen = (await api('GET', '/api/orders/status', { session: mine })).body.orders;
  assert.deepEqual(seen.map((o) => o.id), [myOrder.id]);

  assert.deepEqual(await stages(await scan('T4')), [], 'a guest who has ordered nothing sees nothing');
});

test('it needs a live guest session', async () => {
  assert.equal((await api('GET', '/api/orders/status')).status, 401);
  assert.equal((await api('GET', '/api/orders/status', { session: '99999999-9999-4999-8999-999999999999' })).status, 401);

  const session = await scan('T3');
  await db.query("update guest_sessions set expires_at = now() - interval '1 minute' where id = $1", [session]);
  const expired = await api('GET', '/api/orders/status', { session });
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'guest_session_expired');
});

test("it reports how this café's food reaches the customer, defaulting to the table", async () => {
  const session = await scan('T2');
  assert.equal((await api('GET', '/api/orders/status', { session })).body.service_mode, 'table');

  await db.query("update restaurants set service_mode = 'counter' where id = $1", [RESTAURANT_ID]);
  try {
    assert.equal((await api('GET', '/api/orders/status', { session })).body.service_mode, 'counter');
  } finally {
    await db.query("update restaurants set service_mode = 'table' where id = $1", [RESTAURANT_ID]);
  }
});

test('the database refuses a service mode that is not one of the two', async () => {
  await assert.rejects(
    db.query("update restaurants set service_mode = 'drive-through' where id = $1", [RESTAURANT_ID]),
    /service_mode|check/i,
  );
});
