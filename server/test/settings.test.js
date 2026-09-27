import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// Settings — the café's own profile, renaming/pausing a table, and a staff
// member changing their own display name. Real Postgres (PGlite) with the
// repo's own migrations and seed; only Supabase Auth is faked.

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KITCHEN = 'a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9';
const OTHER_CAFE_OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db;
let server;
let base;
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

  const { rows } = await db.query(`insert into restaurants (name) values ('Other Cafe') returning id`);
  otherRestaurantId = rows[0].id;

  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $4, 'owner', 'Mita'), ($2, $4, 'staff', 'Ravi'), ($3, $4, 'kitchen', 'Bikash'),
       ($5, $6, 'owner', 'Rival')`,
    [OWNER, STAFF, KITCHEN, RESTAURANT_ID, OTHER_CAFE_OWNER, otherRestaurantId],
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

const tableNamed = async (label) =>
  (await db.query('select * from restaurant_tables where restaurant_id = $1 and label = $2', [RESTAURANT_ID, label])).rows[0];

// --- GET /restaurant ---------------------------------------------------------

test('every role can read the café profile; a café only ever sees its own', async () => {
  assert.equal((await call('GET', '/api/restaurant')).status, 401);

  // The kitchen reads it too: the currency alone decides how every price on
  // their screen is formatted.
  for (const who of [OWNER, STAFF, KITCHEN]) {
    const res = await call('GET', '/api/restaurant', { as: who });
    assert.equal(res.status, 200);
    assert.equal(res.body.restaurant.name, 'Chai Point Cafe');
    assert.equal(res.body.restaurant.currency_code, 'INR');
  }

  const theirs = await call('GET', '/api/restaurant', { as: OTHER_CAFE_OWNER });
  assert.equal(theirs.body.restaurant.name, 'Other Cafe');
});

test('address and phone start empty — an unfilled café is a normal state, not a broken record', async () => {
  const res = await call('GET', '/api/restaurant', { as: OWNER });
  assert.equal(res.body.restaurant.address, null);
  assert.equal(res.body.restaurant.phone, null);
});

// --- PATCH /restaurant -------------------------------------------------------

test('changing the café profile is owner only, and validates the input', async () => {
  assert.equal((await call('PATCH', '/api/restaurant', { body: { name: 'X' } })).status, 401);
  assert.equal((await call('PATCH', '/api/restaurant', { as: STAFF, body: { name: 'X' } })).status, 403);
  assert.equal((await call('PATCH', '/api/restaurant', { as: KITCHEN, body: { name: 'X' } })).status, 403);

  for (const body of [
    {},
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(121) },
    { currency_code: 'RUPEES' },
    { currency_code: 'IN' },
    { phone: 'x'.repeat(41) },
    { tax_rate: 18 }, // not a field here — tax is not built (ARCHITECTURE §2)
  ]) {
    assert.equal((await call('PATCH', '/api/restaurant', { as: OWNER, body })).status, 400, JSON.stringify(body));
  }
});

test('the owner can fill in the profile, and only the fields sent change', async () => {
  const res = await call('PATCH', '/api/restaurant', {
    as: OWNER,
    body: { address: 'north tripura, batarashi road', phone: '8787368753' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.restaurant.address, 'north tripura, batarashi road');
  assert.equal(res.body.restaurant.phone, '8787368753');
  assert.equal(res.body.restaurant.name, 'Chai Point Cafe', 'a field left out keeps its value');

  // Explicit null clears; leaving it out does not.
  const cleared = await call('PATCH', '/api/restaurant', { as: OWNER, body: { address: null } });
  assert.equal(cleared.body.restaurant.address, null);
  assert.equal(cleared.body.restaurant.phone, '8787368753');

  // A blank string clears too, and means exactly the same thing — the form
  // sends whatever is in the box, so this is the path it actually uses.
  const blanked = await call('PATCH', '/api/restaurant', { as: OWNER, body: { phone: '   ' } });
  assert.equal(blanked.body.restaurant.phone, null);
});

test('the currency is stored uppercase and reaches the customer menu', async () => {
  const res = await call('PATCH', '/api/restaurant', { as: OWNER, body: { currency_code: 'aed' } });
  assert.equal(res.body.restaurant.currency_code, 'AED');

  const { rows } = await db.query('select qr_token from restaurant_tables limit 1');
  const menu = await call('GET', `/api/menu/${rows[0].qr_token}`);
  assert.equal(menu.body.restaurant.currency_code, 'AED', 'what the owner sets is what a customer is quoted in');

  await call('PATCH', '/api/restaurant', { as: OWNER, body: { currency_code: 'INR' } });
});

test("renaming the café reaches the customer menu, and another café's profile is untouched", async () => {
  await call('PATCH', '/api/restaurant', { as: OWNER, body: { name: 'Chai Point Coffee House' } });

  const { rows } = await db.query('select qr_token from restaurant_tables limit 1');
  const menu = await call('GET', `/api/menu/${rows[0].qr_token}`);
  assert.equal(menu.body.restaurant.name, 'Chai Point Coffee House');

  const theirs = await call('GET', '/api/restaurant', { as: OTHER_CAFE_OWNER });
  assert.equal(theirs.body.restaurant.name, 'Other Cafe');

  await call('PATCH', '/api/restaurant', { as: OWNER, body: { name: 'Chai Point Cafe' } });
});

// --- PATCH /tables/:tableId --------------------------------------------------

test('renaming and reseating a table is owner only, and validates the input', async () => {
  const t1 = await tableNamed('T1');
  assert.equal((await call('PATCH', `/api/tables/${t1.id}`, { as: STAFF, body: { label: 'A1' } })).status, 403);
  assert.equal((await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: {} })).status, 400);
  assert.equal((await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { seats: 0 } })).status, 400);
  assert.equal((await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { qr_token: 'mine' } })).status, 400);

  const res = await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { label: 'Window 1', seats: 3 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.table.label, 'Window 1');
  assert.equal(res.body.table.seats, 3);

  await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { label: 'T1', seats: 2 } });
});

test('a rename never changes the QR token — the code is printed on something physical', async () => {
  const t2 = await tableNamed('T2');
  const res = await call('PATCH', `/api/tables/${t2.id}`, { as: OWNER, body: { label: 'Corner' } });
  assert.equal(res.body.table.qr_token, t2.qr_token);

  // The printed code still opens the same table, under its new name.
  const menu = await call('GET', `/api/menu/${t2.qr_token}`);
  assert.equal(menu.status, 200);
  assert.equal(menu.body.table.label, 'Corner');

  await call('PATCH', `/api/tables/${t2.id}`, { as: OWNER, body: { label: 'T2' } });
});

test('pausing a table stops its QR code taking orders, and unpausing brings it back', async () => {
  const t3 = await tableNamed('T3');

  const paused = await call('PATCH', `/api/tables/${t3.id}`, { as: OWNER, body: { is_active: false } });
  assert.equal(paused.body.table.is_active, false);

  const closed = await call('GET', `/api/menu/${t3.qr_token}`);
  assert.equal(closed.status, 403);
  assert.equal(closed.body.error.code, 'ordering_unavailable');

  const resumed = await call('PATCH', `/api/tables/${t3.id}`, { as: OWNER, body: { is_active: true } });
  assert.equal(resumed.body.table.is_active, true);
  assert.equal((await call('GET', `/api/menu/${t3.qr_token}`)).status, 200);
});

test('a duplicate label is a 409; a made-up or another café\'s table is 404', async () => {
  const t1 = await tableNamed('T1');
  assert.equal((await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { label: 'T2' } })).status, 409);

  assert.equal((await call('PATCH', '/api/tables/99999999-9999-4999-8999-999999999999', { as: OWNER, body: { label: 'X' } })).status, 404);
  assert.equal((await call('PATCH', `/api/tables/${t1.id}`, { as: OTHER_CAFE_OWNER, body: { label: 'Stolen' } })).status, 404);
});

// --- the floor plan ----------------------------------------------------------

test('every table has a cell, and the list reads in layout order', async () => {
  const res = await call('GET', '/api/tables', { as: OWNER });
  const placed = res.body.tables;
  assert.ok(placed.every((t) => t.pos_x !== null && t.pos_y !== null), 'nothing is left unplaced');

  // Layout order, not creation order: left to right, front to back.
  const order = placed.map((t) => `${t.pos_y}:${t.pos_x}`);
  assert.deepEqual(order, [...order].sort(), 'reads the way the room does');
});

test('a new table lands in the first genuinely free cell, not "however many tables there are"', async () => {
  // Free up an early cell by moving its table to the back of the room.
  const t1 = await tableNamed('T1');
  await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { pos_x: 9, pos_y: 9 } });

  const created = await call('POST', '/api/tables', { as: OWNER, body: { label: 'T9', seats: 2 } });
  assert.equal(created.status, 201);
  assert.deepEqual(
    { x: created.body.table.pos_x, y: created.body.table.pos_y },
    { x: t1.pos_x, y: t1.pos_y },
    'fills the gap that was left, rather than landing on top of something',
  );

  await call('DELETE', `/api/tables/${created.body.table.id}`, { as: OWNER });
  await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { pos_x: t1.pos_x, pos_y: t1.pos_y } });
});

test('a table can be dropped on an explicit cell, and two tables can never share one', async () => {
  const t1 = await tableNamed('T1');
  const t2 = await tableNamed('T2');

  const moved = await call('PATCH', `/api/tables/${t2.id}`, { as: OWNER, body: { pos_x: 7, pos_y: 3 } });
  assert.equal(moved.body.table.pos_x, 7);
  assert.equal(moved.body.table.pos_y, 3);

  // Onto a square that is already taken.
  const clash = await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { pos_x: 7, pos_y: 3 } });
  assert.equal(clash.status, 409, 'the database refuses the stack, not the UI');

  await call('PATCH', `/api/tables/${t2.id}`, { as: OWNER, body: { pos_x: t2.pos_x, pos_y: t2.pos_y } });
});

test('a position must be a real cell, and half a position is refused', async () => {
  const t1 = await tableNamed('T1');
  for (const body of [{ pos_x: -1, pos_y: 0 }, { pos_x: 0, pos_y: 20 }, { pos_x: 1.5, pos_y: 0 }, { pos_x: 3 }, { pos_y: 3 }]) {
    assert.equal((await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body })).status, 400, JSON.stringify(body));
  }
});

test('the POS floor map draws the room the owner laid out, not the order tables were added', async () => {
  const t1 = await tableNamed('T1'); // oldest table, and seeded at the front of the room
  // Move it to the back, so creation order and layout order genuinely differ —
  // seeded, they happen to agree, and a test on that data proves nothing.
  await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { pos_x: 5, pos_y: 5 } });
  try {
    const floor = await call('GET', '/api/floor', { as: OWNER });
    assert.equal(floor.status, 200);
    assert.ok(floor.body.tables.every((t) => t.pos_x !== null), 'POS gets the positions too');

    const labels = floor.body.tables.map((t) => t.label);
    assert.equal(labels.at(-1), 'T1', 'the oldest table reads last, because that is where it now sits');

    const order = floor.body.tables.map((t) => `${t.pos_y}:${t.pos_x}`);
    assert.deepEqual(order, [...order].sort(), 'same layout order as the seating plan');
  } finally {
    await call('PATCH', `/api/tables/${t1.id}`, { as: OWNER, body: { pos_x: t1.pos_x, pos_y: t1.pos_y } });
  }
});

// --- DELETE /tables/:tableId -------------------------------------------------

test('retiring a table is owner only', async () => {
  const t1 = await tableNamed('T1');
  assert.equal((await call('DELETE', `/api/tables/${t1.id}`)).status, 401);
  assert.equal((await call('DELETE', `/api/tables/${t1.id}`, { as: STAFF })).status, 403);
  assert.equal((await call('DELETE', '/api/tables/99999999-9999-4999-8999-999999999999', { as: OWNER })).status, 404);
  assert.equal((await call('DELETE', `/api/tables/${t1.id}`, { as: OTHER_CAFE_OWNER })).status, 404);
});

test('retiring a table keeps its order history — the delete is soft, because the FK cascades', async () => {
  const { rows } = await db.query(
    `insert into restaurant_tables (restaurant_id, label, seats) values ($1, 'Retiring', 2) returning id, qr_token`,
    [RESTAURANT_ID],
  );
  const { id, qr_token } = rows[0];

  // A real, paid order at that table, exactly what a retired table would have.
  const menu = await call('GET', `/api/menu/${qr_token}`);
  const session = menu.body.session.id;
  const item = menu.body.categories.flatMap((c) => c.items)[0];
  await fetch(`${base}/api/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Session': session },
    body: JSON.stringify({ menu_item_id: item.id, quantity: 1 }),
  });
  const cart = await (await fetch(`${base}/api/cart`, { headers: { 'X-Guest-Session': session } })).json();
  const placed = await (
    await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Guest-Session': session },
      body: JSON.stringify({ cart_id: cart.cart_id }),
    })
  ).json();
  const orderId = placed.order.id;
  await db.query('update orders set paid_at = now() where id = $1', [orderId]);

  const before = (await db.query('select count(*)::int n from order_items where order_id = $1', [orderId])).rows[0].n;
  assert.ok(before > 0);

  assert.equal((await call('DELETE', `/api/tables/${id}`, { as: OWNER })).status, 204);

  // The order and its lines are still there — a hard delete would have
  // cascaded them away.
  const after = (await db.query('select count(*)::int n from order_items where order_id = $1', [orderId])).rows[0].n;
  assert.equal(after, before, 'the history survives the table');
  assert.equal((await db.query('select count(*)::int n from orders where id = $1', [orderId])).rows[0].n, 1);

  // And the table is gone from every screen, its code dead.
  assert.ok(!(await call('GET', '/api/tables', { as: OWNER })).body.tables.some((t) => t.id === id));
  assert.ok(!(await call('GET', '/api/floor', { as: OWNER })).body.tables.some((t) => t.id === id));
  assert.equal((await call('GET', `/api/menu/${qr_token}`)).status, 404, "a retired table's QR code stops resolving");
});

test('a table that still owes money cannot be retired', async () => {
  const { rows } = await db.query(
    `insert into restaurant_tables (restaurant_id, label, seats) values ($1, 'Owing', 2) returning id, qr_token`,
    [RESTAURANT_ID],
  );
  const { id, qr_token } = rows[0];

  const menu = await call('GET', `/api/menu/${qr_token}`);
  const session = menu.body.session.id;
  const item = menu.body.categories.flatMap((c) => c.items)[0];
  await fetch(`${base}/api/cart/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Session': session },
    body: JSON.stringify({ menu_item_id: item.id, quantity: 2 }),
  });
  const cart = await (await fetch(`${base}/api/cart`, { headers: { 'X-Guest-Session': session } })).json();
  await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Session': session },
    body: JSON.stringify({ cart_id: cart.cart_id }),
  });

  const refused = await call('DELETE', `/api/tables/${id}`, { as: OWNER });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'unpaid_orders');
  assert.equal(refused.body.error.unpaid_count, 1);

  // Settle it and it retires fine.
  await db.query('update orders set paid_at = now() where table_id = $1', [id]);
  assert.equal((await call('DELETE', `/api/tables/${id}`, { as: OWNER })).status, 204);
});

test('a retired table gives up its name and its cell for the next one', async () => {
  const { rows } = await db.query(
    `insert into restaurant_tables (restaurant_id, label, seats, pos_x, pos_y) values ($1, 'Corner', 2, 11, 11) returning id`,
    [RESTAURANT_ID],
  );
  assert.equal((await call('DELETE', `/api/tables/${rows[0].id}`, { as: OWNER })).status, 204);

  // Same name, same square — the old row exists for history, not to hold a
  // name hostage.
  const again = await call('POST', '/api/tables', { as: OWNER, body: { label: 'Corner', seats: 4, pos_x: 11, pos_y: 11 } });
  assert.equal(again.status, 201);
  assert.notEqual(again.body.table.id, rows[0].id);
  assert.notEqual(again.body.table.qr_token, undefined);

  await call('DELETE', `/api/tables/${again.body.table.id}`, { as: OWNER });
});

// --- PATCH /me ---------------------------------------------------------------

test('anyone signed in can change their own display name', async () => {
  assert.equal((await call('PATCH', '/api/me', { body: { display_name: 'X' } })).status, 401);

  const res = await call('PATCH', '/api/me', { as: KITCHEN, body: { display_name: 'Bikash Das' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.staff.displayName, 'Bikash Das');
  assert.equal(res.body.staff.role, 'kitchen');

  // And it's what the next request reports.
  assert.equal((await call('GET', '/api/me', { as: KITCHEN })).body.staff.displayName, 'Bikash Das');
});

test('changing your own name can never change your own role', async () => {
  const res = await call('PATCH', '/api/me', { as: KITCHEN, body: { display_name: 'Bikash', role: 'owner' } });
  assert.equal(res.status, 400, 'a role is not a field here at all');

  const { rows } = await db.query('select role from staff_members where user_id = $1', [KITCHEN]);
  assert.equal(rows[0].role, 'kitchen');
});

test('a blank or missing display name is refused, not silently stored', async () => {
  for (const body of [{}, { display_name: '' }, { display_name: '   ' }, { display_name: 'x'.repeat(81) }]) {
    assert.equal((await call('PATCH', '/api/me', { as: STAFF, body })).status, 400, JSON.stringify(body));
  }
});
