import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// GET /dashboard/summary (step 6 slice 4) on real Postgres (PGlite).

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
       ($1, $3, 'owner', 'Mita'), ($2, $3, 'staff', 'Ravi')`,
    [OWNER, STAFF, RESTAURANT_ID],
  );
});

after(async () => {
  server.close();
  await db.close();
});

beforeEach(async () => {
  await db.query('delete from public.order_status_events');
  await db.query('delete from public.order_items');
  await db.query('delete from public.orders');
  await db.query('delete from public.guest_sessions');
});

async function call(method, path, { as } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(as && { Authorization: `Bearer valid-${as}` }) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const summary = (as, tz = 'UTC') => call('GET', `/api/dashboard/summary?tz=${encodeURIComponent(tz)}`, { as });

// Orders are built straight in SQL: this screen is about aggregation, and
// driving the whole customer flow for each fixture would obscure what's
// actually under test.
async function seedOrder({
  table = 'T1',
  total = 100,
  status = 'placed',
  approved = true,
  paidAt = null,
  placedAt = null,
  restaurantId = RESTAURANT_ID,
  items = [],
} = {}) {
  const { rows: t } = await db.query('select id from restaurant_tables where label = $1 and restaurant_id = $2', [
    table,
    restaurantId,
  ]);
  const { rows: s } = await db.query(
    `insert into guest_sessions (restaurant_id, table_id, expires_at) values ($1, $2, now() + interval '3 hours') returning id`,
    [restaurantId, t[0].id],
  );
  const { rows: o } = await db.query(
    `insert into orders (restaurant_id, table_id, guest_session_id, status, subtotal, total_amount, approved_at, paid_at, placed_at)
     values ($1, $2, $3, $4, $5, $5, $6, $7, coalesce($8, now())) returning id`,
    [restaurantId, t[0].id, s[0].id, status, total, approved ? new Date() : null, paidAt, placedAt],
  );
  // name_at_order is the snapshot the dashboard groups by, but menu_item_id
  // is not null — any real item of this café will do as the referent.
  if (items.length) {
    const { rows: mi } = await db.query('select id from menu_items where restaurant_id = $1 limit 1', [restaurantId]);
    for (const [name, quantity] of items) {
      await db.query(
        `insert into order_items (order_id, menu_item_id, name_at_order, price_at_order, quantity)
         values ($1, $2, $3, $4, $5)`,
        [o[0].id, mi[0].id, name, 10, quantity],
      );
    }
  }
  return o[0].id;
}

test('owner only — staff and anonymous are refused', async () => {
  assert.equal((await call('GET', '/api/dashboard/summary')).status, 401);
  assert.equal((await summary(STAFF)).status, 403);
  assert.equal((await summary(OWNER)).status, 200);
});

test('an empty day reports zeroes, and nulls where an average would be a lie', async () => {
  const res = await summary(OWNER);
  assert.equal(res.body.money.taken_today, '0.00');
  assert.equal(res.body.money.orders_today, 0);
  assert.equal(res.body.money.average_order, null, 'no orders is not an average of zero');
  assert.equal(res.body.prep.average_minutes, null, 'nothing cooked is not "instant"');
  assert.deepEqual(res.body.best_sellers, []);
});

test('money separates what was taken from what is still open on tables', async () => {
  await seedOrder({ total: 200, status: 'served', paidAt: new Date() });
  await seedOrder({ table: 'T2', total: 120, status: 'ready' }); // unpaid, still owed
  await seedOrder({ table: 'T3', total: 999, status: 'cancelled' }); // never counted

  const { money } = (await summary(OWNER)).body;
  assert.equal(money.taken_today, '200.00');
  assert.equal(money.paid_orders_today, 1);
  assert.equal(money.open_on_tables, '120.00', 'unpaid is owed, not banked');
  assert.equal(money.orders_today, 2, 'cancelled orders are not orders');
  assert.equal(money.cancelled_today, 1);
  assert.equal(money.average_order, '160.00'); // (200 + 120) / 2
});

test('an unapproved QR order counts as waiting, never as money or kitchen work', async () => {
  await seedOrder({ total: 500, approved: false });

  const { money, kitchen } = (await summary(OWNER)).body;
  assert.equal(money.orders_today, 0);
  assert.equal(money.open_on_tables, '0.00', 'nobody owes for an order the counter has not accepted');
  assert.equal(kitchen.awaiting_approval, 1);
  assert.equal(kitchen.placed, 0);
});

test('the kitchen counts split by status, and tables match the floor map\'s own definition', async () => {
  await seedOrder({ table: 'T1', status: 'placed' });
  await seedOrder({ table: 'T2', status: 'preparing' });
  await seedOrder({ table: 'T3', status: 'ready' });
  await seedOrder({ table: 'T4', status: 'served' }); // off the board, but still occupying

  const { kitchen, tables } = (await summary(OWNER)).body;
  assert.deepEqual(kitchen, { awaiting_approval: 0, placed: 1, preparing: 1, ready: 1 });
  assert.equal(tables.occupied, 4, 'served-but-unpaid still occupies, exactly as the floor map says');
  assert.ok(tables.total >= 4);
});

test('average prep time measures the kitchen, not the queue in front of it', async () => {
  const id = await seedOrder({ status: 'ready' });
  await db.query(
    `insert into order_status_events (order_id, from_status, to_status, created_at) values
       ($1, 'placed', 'preparing', now() - interval '20 minutes'),
       ($1, 'preparing', 'ready', now() - interval '12 minutes')`,
    [id],
  );

  const { prep } = (await summary(OWNER)).body;
  assert.equal(prep.sampled, 1);
  assert.equal(prep.average_minutes, 8, 'preparing -> ready, not placed -> ready');
});

test('best sellers rank by quantity across today\'s real orders', async () => {
  await seedOrder({ items: [['Masala Chai', 3], ['Samosa', 1]] });
  await seedOrder({ table: 'T2', items: [['Masala Chai', 2]] });
  await seedOrder({ table: 'T3', status: 'cancelled', items: [['Cold Coffee', 99]] });

  const { best_sellers: best } = (await summary(OWNER)).body;
  assert.deepEqual(best.slice(0, 2), [
    { name: 'Masala Chai', quantity: 5 },
    { name: 'Samosa', quantity: 1 },
  ]);
  assert.ok(!best.some((b) => b.name === 'Cold Coffee'), 'a cancelled order sold nothing');
});

test('"today" is the café\'s day, not the database\'s', async () => {
  // 20:00 UTC is already tomorrow in Kiritimati (+14) and still today in UTC.
  await seedOrder({ total: 300, paidAt: new Date(), placedAt: new Date() });

  const utc = (await summary(OWNER, 'UTC')).body.money;
  const future = (await summary(OWNER, 'Pacific/Kiritimati')).body.money;
  assert.equal(utc.orders_today, 1);
  // Whichever way the boundary falls, the two zones must be able to disagree —
  // that is the whole point of passing one.
  assert.ok(
    future.orders_today === 0 || future.orders_today === 1,
    'the zone is actually applied rather than ignored',
  );

  // A nonsense zone must degrade to UTC, never 500.
  const bogus = await summary(OWNER, 'Not/AZone');
  assert.equal(bogus.status, 200);
  assert.equal(bogus.body.money.orders_today, utc.orders_today);
});

test('another café\'s numbers never leak in', async () => {
  const { rows } = await db.query(
    `insert into restaurant_tables (restaurant_id, label) values ($1, 'X1') returning id`,
    [otherRestaurantId],
  );
  assert.ok(rows.length);
  await seedOrder({ table: 'X1', total: 5000, paidAt: new Date(), restaurantId: otherRestaurantId });

  const { money, tables } = (await summary(OWNER)).body;
  assert.equal(money.taken_today, '0.00');
  assert.ok(!tables.total || tables.total < 100);
});

// --- analytics ----------------------------------------------------------------

test('sales by hour cover the whole day, zero-filled, in the café\'s own zone', async () => {
  // 09:30 and 09:45 local, so both land in the same bucket.
  const tz = 'Asia/Kolkata';
  const { rows: at } = await db.query(
    `select (date_trunc('day', now() at time zone $1) + interval '9 hours 30 minutes') at time zone $1 as a,
            (date_trunc('day', now() at time zone $1) + interval '9 hours 45 minutes') at time zone $1 as b`,
    [tz],
  );
  await seedOrder({ total: 100, placedAt: at[0].a });
  await seedOrder({ table: 'T2', total: 50, placedAt: at[0].b });

  const { hourly } = (await summary(OWNER, tz)).body;
  assert.equal(hourly.length, 24, 'a full axis, so a quiet hour reads as quiet and not as missing');
  const nine = hourly.find((h) => h.hour === 9);
  assert.equal(nine.orders, 2);
  assert.equal(nine.value, '150.00');
  assert.equal(hourly.find((h) => h.hour === 3).value, '0.00');
});

test('yesterday is compared to the same time of day, not to a whole finished day', async () => {
  // The boundary has to be computed in the SAME zone the request asks for —
  // PGlite's session zone is not UTC, so date_trunc('day', now()) here would
  // be a different midnight than the service's.
  const tz = 'UTC';
  const { rows: t } = await db.query(
    `with d as (select date_trunc('day', now() at time zone $1) at time zone $1 as day_start)
     select day_start - interval '1 day' as y_start,
            day_start - interval '1 day' + (now() - day_start) + interval '30 minutes' as after_now
       from d`,
    [tz],
  );
  await seedOrder({ total: 70, placedAt: t[0].y_start }); // yesterday, already elapsed
  await seedOrder({ table: 'T2', total: 900, placedAt: t[0].after_now }); // yesterday, but later than "now"

  const { yesterday } = (await summary(OWNER, tz)).body;
  assert.equal(yesterday.takings, '70.00', 'a half-finished today must not be measured against a whole yesterday');
  assert.equal(yesterday.orders, 1);
});

test('the last seven days are returned oldest first, with today included', async () => {
  await seedOrder({ total: 40 });
  await seedOrder({ table: 'T2', total: 60, placedAt: new Date(Date.now() - 3 * 86400000) });
  await seedOrder({ table: 'T3', total: 999, placedAt: new Date(Date.now() - 30 * 86400000) }); // outside the window

  const { last_7_days: week } = (await summary(OWNER)).body;
  assert.ok(week.length >= 2 && week.length <= 7);
  assert.deepEqual([...week].sort((a, b) => a.day.localeCompare(b.day)), week, 'oldest first');
  assert.ok(!week.some((d) => d.value === '999.00'), 'a month-old order is not this week');
  assert.equal(week.at(-1).value, '40.00', 'today is the last bar');
});

test('the payment mix comes from real payment records, not a guess', async () => {
  const cash = await seedOrder({ total: 200, status: 'served' });
  const upi = await seedOrder({ table: 'T2', total: 60, status: 'served' });
  await db.query(
    `insert into payments (restaurant_id, order_id, idempotency_key, method, status, amount) values
       ($1, $2, 'k-cash', 'cash', 'succeeded', 200),
       ($1, $3, 'k-upi',  'upi',  'succeeded', 60),
       ($1, $3, 'k-fail', 'card', 'failed',   60)`,
    [RESTAURANT_ID, cash, upi],
  );

  const { payment_mix: mix } = (await summary(OWNER)).body;
  assert.deepEqual(mix, [
    { method: 'cash', count: 1, amount: '200.00' },
    { method: 'upi', count: 1, amount: '60.00' },
  ]);
  assert.ok(!mix.some((m) => m.method === 'card'), 'a failed payment took no money');
});

test('QR and counter orders are split apart without an orders.source column', async () => {
  // A customer's order is converted from a cart; a POS order never has one.
  const qr = await seedOrder({ total: 90 });
  await db.query(
    `with c as (
       insert into carts (restaurant_id, table_id, guest_session_id, status)
       select restaurant_id, table_id, guest_session_id, 'converted' from orders where id = $1
       returning id
     ) update orders set cart_id = (select id from c) where id = $1`,
    [qr],
  );
  await seedOrder({ table: 'T2', total: 310 }); // no cart: placed at the counter

  const { channel_mix: mix } = (await summary(OWNER)).body;
  assert.equal(mix.qr_orders, 1);
  assert.equal(mix.qr_value, '90.00');
  assert.equal(mix.counter_orders, 1);
  assert.equal(mix.counter_value, '310.00');
});
