import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { planState, GRACE_DAYS } from '../src/services/platform.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// The platform owner's area (/api/admin) on real Postgres (PGlite): who may open
// it, the monthly figures per café, plan state, and recording a payment.

const ADMIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAFE_OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOBODY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SELLER = { name: 'Test Seller', address: '1 Test Road', phone: null, email: 'bills@test.example', tax_id: null };

let db;
let server;
let base;
let cafeB; // a second café, with one table

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
  const app = createApp({
    config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3, billingSeller: SELLER },
    db,
    supabase,
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;

  await db.query(`insert into platform_admins (user_id) values ($1)`, [ADMIN]);
  await db.query(`insert into staff_members (user_id, restaurant_id, role, display_name) values ($1, $2, 'owner', 'Mita')`, [CAFE_OWNER, RESTAURANT_ID]);
  const { rows } = await db.query(`insert into restaurants (name, owner_email) values ('Beta Brew', 'beta@example.com') returning id`);
  cafeB = rows[0].id;
  await db.query(`insert into restaurant_tables (restaurant_id, label) values ($1, 'B1')`, [cafeB]);
});

after(async () => {
  server.close();
  await db.close();
});

beforeEach(async () => {
  await db.query('delete from public.subscription_events');
  await db.query('delete from public.subscription_payments');
  await db.query('delete from public.bill_lines');
  await db.query('delete from public.bills');
  await db.query('delete from public.order_status_events');
  await db.query('delete from public.order_items');
  await db.query('delete from public.orders');
  await db.query('delete from public.guest_sessions');
  // Both cafés start each test in the same place: mid-trial, never paid.
  await db.query(`update public.restaurants set trial_ends_at = now() + interval '10 days', paid_until = null where id in ($1, $2)`, [RESTAURANT_ID, cafeB]);
  await db.query(`update public.restaurants set name = 'Chai Point Cafe' where id = $1`, [RESTAURANT_ID]);
  await db.query(`update public.restaurants set name = 'Beta Brew' where id = $1`, [cafeB]);
  // Invoice numbers start again at 1 for each test, so they can be asserted exactly.
  await db.query(`alter table public.subscription_payments alter column invoice_seq restart with 1`);
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
const admin = (method, path, body) => call(method, path, { as: ADMIN, body });

// Orders and bills are built straight in SQL: these screens are about aggregation,
// and driving the customer flow for each fixture would hide what is under test.
let billNo = 0;
async function order({ cafe = RESTAURANT_ID, source = 'qr', total = 100, status = 'served', approved = true, at = new Date().toISOString() } = {}) {
  const { rows: t } = await db.query(`select id from restaurant_tables where restaurant_id = $1 order by label limit 1`, [cafe]);
  const { rows: s } = await db.query(
    `insert into guest_sessions (restaurant_id, table_id, expires_at) values ($1, $2, now() + interval '3 hours') returning id`,
    [cafe, t[0].id],
  );
  await db.query(
    `insert into orders (restaurant_id, table_id, guest_session_id, status, subtotal, total_amount, approved_at, placed_at, source)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8)`,
    [cafe, t[0].id, s[0].id, status, total, approved ? at : null, at, source],
  );
}
async function bill({ cafe = RESTAURANT_ID, total = 100, at = new Date().toISOString() } = {}) {
  await db.query(
    `insert into bills (restaurant_id, bill_number, idempotency_key, table_label, restaurant_name, currency_code, payment_method, subtotal, total_amount, settled_at)
     values ($1, $2, $3, 'T1', 'Cafe', 'INR', 'cash', $4, $4, $5)`,
    [cafe, ++billNo, `k${billNo}`, total, at],
  );
}

const figures = (report, id) => report.cafes.find((c) => c.id === id);

// --- who may open it ---------------------------------------------------------

test('the admin area needs a login that is on the platform admin list: nothing else gets in', async () => {
  const paths = ['/api/admin/me', '/api/admin/overview', '/api/admin/report', '/api/admin/restaurants', `/api/admin/restaurants/${RESTAURANT_ID}`];
  for (const path of paths) {
    assert.equal((await call('GET', path)).status, 401, `${path}: no login`);
    assert.equal((await call('GET', path, { as: NOBODY })).status, 403, `${path}: a login that is nobody's admin`);
    assert.equal((await call('GET', path, { as: CAFE_OWNER })).status, 403, `${path}: a café's owner is not a platform admin`);
    assert.equal((await admin('GET', path)).status, 200, `${path}: the admin`);
  }
  const forged = await fetch(`${base}/api/admin/me`, { headers: { Authorization: 'Bearer garbage' } });
  assert.equal(forged.status, 401, 'a token that is not a real login');
});

test('a café owner cannot record a payment or extend a trial, and nothing is written', async () => {
  const pay = await call('POST', `/api/admin/restaurants/${RESTAURANT_ID}/payments`, { as: CAFE_OWNER, body: { amount: 1499, method: 'upi', reference: 'X1' } });
  assert.equal(pay.status, 403);
  const ext = await call('POST', `/api/admin/restaurants/${RESTAURANT_ID}/extend-trial`, { as: CAFE_OWNER, body: { days: 30 } });
  assert.equal(ext.status, 403);
  assert.equal((await db.query('select count(*)::int n from subscription_payments')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from subscription_events')).rows[0].n, 0);
});

// --- plan state --------------------------------------------------------------

test('plan state: trialing, active, grace, locked, from the two dates and the clock', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const day = (n) => new Date(now.getTime() + n * 86_400_000).toISOString();

  assert.equal(planState({ trial_ends_at: day(5), paid_until: null }, now).state, 'trialing');
  assert.equal(planState({ trial_ends_at: day(5), paid_until: null }, now).days_left, 5);
  assert.equal(planState({ trial_ends_at: day(-1), paid_until: day(30) }, now).state, 'active');
  assert.equal(planState({ trial_ends_at: day(-20), paid_until: day(0.001) }, now).state, 'active', 'still paid for a few more minutes');

  assert.equal(planState({ trial_ends_at: day(-1), paid_until: null }, now).state, 'grace', 'day 15 is grace, not locked');
  assert.equal(planState({ trial_ends_at: day(-(GRACE_DAYS - 0.1)), paid_until: null }, now).state, 'grace');
  assert.equal(planState({ trial_ends_at: day(-(GRACE_DAYS + 0.1)), paid_until: null }, now).state, 'locked');
  // A lapsed PAID plan gets the same grace, counted from when it ended, not from the old trial.
  assert.equal(planState({ trial_ends_at: day(-200), paid_until: day(-1) }, now).state, 'grace');
  assert.equal(planState({ trial_ends_at: day(-200), paid_until: day(-10) }, now).state, 'locked');
});

// --- the monthly report ------------------------------------------------------

test('the monthly report counts QR and POS orders, money taken and order value, and what to leave out', async () => {
  const oct = (d, h = 12) => `2026-10-${d}T${String(h).padStart(2, '0')}:00:00+05:30`;
  await order({ source: 'qr', total: 100, at: oct('05') });
  await order({ source: 'qr', total: 50, at: oct('06') });
  await order({ source: 'pos', total: 200, at: oct('07') });
  // None of these are real orders for the month's figures:
  await order({ source: 'qr', total: 999, status: 'cancelled', at: oct('08') }); // cancelled after acceptance
  await order({ source: 'qr', total: 999, status: 'placed', approved: false, at: oct('09') }); // still waiting at the counter
  await order({ source: 'qr', total: 999, status: 'cancelled', approved: false, at: oct('10') }); // rejected at the counter
  await order({ source: 'qr', total: 80, at: '2026-09-15T12:00:00+05:30' }); // last month
  await bill({ total: 300, at: oct('07') });
  await bill({ total: 150.5, at: oct('20') });
  await bill({ total: 40, at: '2026-09-15T12:00:00+05:30' });

  const { status, body } = await admin('GET', '/api/admin/report?month=2026-10');
  assert.equal(status, 200);
  assert.equal(body.month, '2026-10');
  assert.equal(body.previous_month, '2026-09');

  const a = figures(body, RESTAURANT_ID);
  assert.equal(a.qr_orders, 2);
  assert.equal(a.pos_orders, 1);
  assert.equal(a.orders, 3);
  assert.equal(a.qr_value, '150.00');
  assert.equal(a.pos_value, '200.00');
  assert.equal(a.order_value, '350.00');
  assert.equal(a.sales, '450.50', 'money taken is the settled bills, not the order values');
  assert.equal(a.bills, 2);
  assert.equal(a.average_order, '116.67');
  assert.equal(a.cancelled, 2, 'cancelled and rejected both');
  assert.deepEqual(a.previous, { orders: 1, order_value: '80.00', sales: '40.00' });
  assert.equal(a.change.sales, 1026.3);
  assert.equal(a.change.orders, 200);

  // A café with no activity: zeros, and "no average" rather than an average of 0.
  const b = figures(body, cafeB);
  assert.equal(b.orders, 0);
  assert.equal(b.sales, '0.00');
  assert.equal(b.average_order, null);
  assert.equal(b.last_order_at, null);
  assert.equal(b.change.sales, null, 'no "+100% vs nothing"');

  // Totals across cafés, in order of money taken.
  assert.equal(body.totals.orders, 3);
  assert.equal(body.totals.sales, '450.50');
  assert.equal(body.totals.qr_orders + body.totals.pos_orders, body.totals.orders);
  assert.equal(body.cafes[0].id, RESTAURANT_ID, 'busiest first');
});

test('a month is an India month: an order just after midnight IST belongs to the new month', async () => {
  // 00:30 IST on 1 October is still 19:00 on 30 September in UTC.
  await order({ source: 'qr', total: 10, at: '2026-09-30T19:00:00Z' });
  // 00:30 IST on 1 November is 19:00 UTC on 31 October.
  await order({ source: 'qr', total: 20, at: '2026-10-31T19:00:00Z' });

  const oct = figures((await admin('GET', '/api/admin/report?month=2026-10')).body, RESTAURANT_ID);
  assert.equal(oct.qr_orders, 1);
  assert.equal(oct.qr_value, '10.00');
  const nov = figures((await admin('GET', '/api/admin/report?month=2026-11')).body, RESTAURANT_ID);
  assert.equal(nov.qr_orders, 1);
  assert.equal(nov.qr_value, '20.00');
});

test('the report validates the month and defaults to this one', async () => {
  assert.equal((await admin('GET', '/api/admin/report?month=2026-13')).status, 400);
  assert.equal((await admin('GET', '/api/admin/report?month=October')).status, 400);
  const now = (await admin('GET', '/api/admin/report')).body;
  assert.match(now.month, /^\d{4}-\d{2}$/);
  await order({ source: 'pos', total: 60 });
  const withToday = (await admin('GET', '/api/admin/report')).body;
  assert.equal(figures(withToday, RESTAURANT_ID).pos_orders, 1, 'an order placed just now is in the current month');
});

// --- overview ----------------------------------------------------------------

test('the overview counts cafés by plan state and lists who needs a call', async () => {
  await db.query(`update restaurants set trial_ends_at = now() + interval '3 days' where id = $1`, [RESTAURANT_ID]); // trialing, ending soon
  await db.query(`update restaurants set trial_ends_at = now() - interval '30 days', paid_until = now() + interval '10 days' where id = $1`, [cafeB]); // paid, expiring soon
  await order({ cafe: cafeB, source: 'qr', total: 10 });
  await admin('POST', `/api/admin/restaurants/${cafeB}/payments`, { amount: 1499, method: 'upi', reference: 'OV1' });

  const { body } = await admin('GET', '/api/admin/overview');
  assert.equal(body.states.trialing, 1);
  assert.equal(body.states.active, 1);
  assert.equal(body.cafes, 2);
  assert.equal(body.received_this_month, '1499.00');
  assert.equal(body.payments_this_month, 1);
  assert.deepEqual(body.trials_ending_soon.map((c) => c.id), [RESTAURANT_ID]);
  assert.deepEqual(body.trials_with_no_orders.map((c) => c.id), [RESTAURANT_ID], 'a trialing café that has not placed an order');
  assert.ok(body.plans_expiring_soon.length === 0, 'the payment just extended Beta Brew by six months');
});

// --- recording a payment -----------------------------------------------------

const pay = (cafe, body) => admin('POST', `/api/admin/restaurants/${cafe}/payments`, body);
const row = async (cafe) => (await db.query('select trial_ends_at, paid_until from restaurants where id = $1', [cafe])).rows[0];

test('paying mid-trial starts the plan when the trial ends, and a renewal stacks on the end of the plan', async () => {
  const before = await row(RESTAURANT_ID);
  const first = await pay(RESTAURANT_ID, { amount: '1499', method: 'upi', reference: 'UTR-1' });
  assert.equal(first.status, 201);
  assert.equal(first.body.payment.invoice_number, 'BNB-0001');
  assert.equal(first.body.plan.state, 'active', 'they have paid, so they are a paying café from now on');

  const { rows: p1 } = await db.query(`select period_start, period_end, amount from subscription_payments where reference = 'UTR-1'`);
  assert.equal(new Date(p1[0].period_start).getTime(), new Date(before.trial_ends_at).getTime(), 'starts when the trial would have ended');
  const { rows: months } = await db.query(`select (extract(year from age($2, $1)) * 12 + extract(month from age($2, $1)))::int as m`, [p1[0].period_start, p1[0].period_end]);
  assert.equal(months[0].m, 6);
  assert.equal(p1[0].amount, '1499.00');
  assert.equal(new Date((await row(RESTAURANT_ID)).paid_until).getTime(), new Date(p1[0].period_end).getTime());

  // A second payment before the plan ends begins exactly where the first one ended.
  const second = await pay(RESTAURANT_ID, { amount: 1499, method: 'bank_transfer', reference: 'UTR-2' });
  assert.equal(second.body.payment.invoice_number, 'BNB-0002');
  const { rows: p2 } = await db.query(`select period_start from subscription_payments where reference = 'UTR-2'`);
  assert.equal(new Date(p2[0].period_start).getTime(), new Date(p1[0].period_end).getTime(), 'stacked, not overlapped');
});

test('paying after the plan has lapsed starts from now, not from a date in the past', async () => {
  await db.query(`update restaurants set trial_ends_at = now() - interval '90 days', paid_until = now() - interval '30 days' where id = $1`, [RESTAURANT_ID]);
  const res = await pay(RESTAURANT_ID, { amount: 1499, method: 'upi', reference: 'LAPSED-1' });
  assert.equal(res.status, 201);
  const { rows } = await db.query(`select extract(epoch from (now() - period_start))::int as ago from subscription_payments where reference = 'LAPSED-1'`);
  assert.ok(rows[0].ago >= 0 && rows[0].ago < 60, `started ${rows[0].ago}s ago`);
  assert.equal(res.body.plan.state, 'active');
});

test('the same payment reference twice is refused, even against another café; cash needs none', async () => {
  assert.equal((await pay(RESTAURANT_ID, { amount: 1499, method: 'upi', reference: 'Dup-1' })).status, 201);
  const again = await pay(cafeB, { amount: 1499, method: 'upi', reference: 'dup-1' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'duplicate_reference');
  assert.equal((await db.query('select count(*)::int n from subscription_payments')).rows[0].n, 1, 'nothing was written');
  assert.equal((await row(cafeB)).paid_until, null, 'and the other café was not extended');

  // The same text under a different method is a different payment; cash has no reference at all.
  assert.equal((await pay(cafeB, { amount: 1499, method: 'bank_transfer', reference: 'dup-1' })).status, 201);
  assert.equal((await pay(RESTAURANT_ID, { amount: 500, method: 'cash' })).status, 201);
  assert.equal((await pay(RESTAURANT_ID, { amount: 500, method: 'cash' })).status, 201);
});

test('a payment is validated: a real amount, a known method, no future date, no stray fields', async () => {
  const bad = [
    { amount: 0, method: 'upi' },
    { amount: -5, method: 'upi' },
    { amount: '12.345', method: 'upi' },
    { amount: 'abc', method: 'upi' },
    { amount: 1499, method: 'bitcoin' },
    { amount: 1499, method: 'upi', paid_on: '2999-01-01' },
    { amount: 1499, method: 'upi', paid_on: 'yesterday' },
    { amount: 1499, method: 'upi', months: 0 },
    { amount: 1499, method: 'upi', plan: 'gold' },
    {},
  ];
  for (const body of bad) {
    assert.equal((await pay(RESTAURANT_ID, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await db.query('select count(*)::int n from subscription_payments')).rows[0].n, 0);
});

test('an unknown café is a 404 everywhere, and a payment for it writes nothing', async () => {
  const ghost = '99999999-9999-4999-8999-999999999999';
  assert.equal((await pay(ghost, { amount: 1499, method: 'upi', reference: 'G1' })).status, 404);
  assert.equal((await admin('POST', `/api/admin/restaurants/${ghost}/extend-trial`, { days: 7 })).status, 404);
  assert.equal((await admin('GET', `/api/admin/restaurants/${ghost}`)).status, 404);
  assert.equal((await db.query('select count(*)::int n from subscription_payments')).rows[0].n, 0);
});

// --- the invoice -------------------------------------------------------------

test('an invoice is a frozen snapshot: renaming the café or changing the seller later changes nothing', async () => {
  const made = await pay(RESTAURANT_ID, { amount: 1499, method: 'upi', reference: 'SNAP-1', paid_on: '2026-10-02' });
  const id = made.body.payment.id;
  await db.query(`update restaurants set name = 'Renamed Cafe' where id = $1`, [RESTAURANT_ID]);

  const { status, body } = await admin('GET', `/api/admin/payments/${id}/invoice`);
  assert.equal(status, 200);
  assert.equal(body.invoice.number, 'BNB-0001');
  assert.equal(body.invoice.buyer.name, 'Chai Point Cafe', 'the name at the time');
  assert.equal(body.invoice.seller.name, 'Test Seller');
  assert.equal(body.invoice.amount, '1499.00');
  assert.equal(body.invoice.reference, 'SNAP-1');
  assert.match(body.invoice.description, /6 months/);
  assert.equal((await call('GET', `/api/admin/payments/${id}/invoice`, { as: CAFE_OWNER })).status, 403);
  assert.equal((await admin('GET', '/api/admin/payments/99999999-9999-4999-8999-999999999999/invoice')).status, 404);
});

// --- extending a trial -------------------------------------------------------

test('extending a trial adds days to the later of now and its end, and is logged', async () => {
  const before = await row(RESTAURANT_ID);
  const res = await admin('POST', `/api/admin/restaurants/${RESTAURANT_ID}/extend-trial`, { days: 7 });
  assert.equal(res.status, 200);
  const after = await row(RESTAURANT_ID);
  assert.equal(new Date(after.trial_ends_at).getTime() - new Date(before.trial_ends_at).getTime(), 7 * 86_400_000);

  // A lapsed trial restarts from today, not from some date in the past.
  await db.query(`update restaurants set trial_ends_at = now() - interval '40 days' where id = $1`, [RESTAURANT_ID]);
  const lapsed = await admin('POST', `/api/admin/restaurants/${RESTAURANT_ID}/extend-trial`, { days: 7 });
  assert.equal(lapsed.body.plan.state, 'trialing');
  assert.ok(lapsed.body.plan.days_left >= 6 && lapsed.body.plan.days_left <= 7);

  const { rows } = await db.query(`select kind, created_by from subscription_events where restaurant_id = $1 order by created_at`, [RESTAURANT_ID]);
  assert.deepEqual(rows.map((r) => r.kind), ['trial_extended', 'trial_extended']);
  assert.equal(rows[0].created_by, ADMIN, 'who did it is recorded');

  for (const days of [0, 61, 1.5, 'ten']) {
    assert.equal((await admin('POST', `/api/admin/restaurants/${RESTAURANT_ID}/extend-trial`, { days })).status, 400, String(days));
  }
});

// --- one café ----------------------------------------------------------------

test('a café\'s detail: a daily series for the month, its payments, and the plan', async () => {
  await order({ source: 'qr', total: 100, at: '2026-10-05T12:00:00+05:30' });
  await order({ source: 'pos', total: 40, at: '2026-10-05T14:00:00+05:30' });
  await order({ source: 'qr', total: 60, at: '2026-10-09T12:00:00+05:30' });
  await bill({ total: 140, at: '2026-10-05T15:00:00+05:30' });
  await pay(RESTAURANT_ID, { amount: 1499, method: 'upi', reference: 'D1' });

  const { status, body } = await admin('GET', `/api/admin/restaurants/${RESTAURANT_ID}?month=2026-10`);
  assert.equal(status, 200);
  assert.equal(body.cafe.name, 'Chai Point Cafe');
  assert.equal(body.daily.length, 31);
  assert.deepEqual(body.daily[0], { day: '2026-10-01', qr_orders: 0, pos_orders: 0, sales: '0.00' });
  assert.deepEqual(body.daily[4], { day: '2026-10-05', qr_orders: 1, pos_orders: 1, sales: '140.00' });
  assert.equal(body.daily[8].qr_orders, 1);
  assert.equal(body.figures.orders, 3);
  assert.equal(body.payments.length, 1);
  assert.equal(body.payments[0].invoice_number, 'BNB-0001');
  assert.equal(body.cafe.team_size, 1);
  assert.deepEqual(body.plan_defaults, { months: 6, amount: '1499.00' });
});

test('the café list shows last activity and plan, newest café first', async () => {
  await order({ source: 'qr', total: 10 });
  const { body } = await admin('GET', '/api/admin/restaurants');
  const names = body.restaurants.map((r) => r.name);
  assert.ok(names.includes('Beta Brew') && names.includes('Chai Point Cafe'));
  const a = body.restaurants.find((r) => r.id === RESTAURANT_ID);
  assert.equal(a.orders_30d, 1);
  assert.ok(a.last_order_at);
  assert.equal(a.plan.state, 'trialing');
  assert.equal(body.restaurants.find((r) => r.id === cafeB).last_order_at, null);
});

// --- where an order came from -------------------------------------------------

test('orders record where they came from: a customer\'s order is qr, a POS order is pos', async () => {
  const get = async (path, headers = {}) => (await fetch(base + path, { headers })).json();
  const send = async (method, path, body, headers = {}) =>
    (await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })).json();

  // A real customer order through the public API.
  const { rows: tok } = await db.query(`select qr_token from restaurant_tables where restaurant_id = $1 order by label limit 1`, [RESTAURANT_ID]);
  const menu = await get(`/api/menu/${tok[0].qr_token}`);
  const session = { 'X-Guest-Session': menu.session.id };
  const item = menu.categories[0].items[0].id;
  await send('POST', '/api/cart/items', { menu_item_id: item, quantity: 1 }, session);
  const cart = await get('/api/cart', session);
  const placed = await send('POST', '/api/orders', { cart_id: cart.cart_id }, session);

  // A real POS order, as the café's owner.
  const { rows: table } = await db.query(`select id from restaurant_tables where restaurant_id = $1 order by label limit 1`, [RESTAURANT_ID]);
  await send('POST', '/api/staff/orders', { table_id: table[0].id, items: [{ menu_item_id: item, quantity: 1 }] }, { Authorization: `Bearer valid-${CAFE_OWNER}` });

  const { rows } = await db.query(`select source, cart_id is not null as had_cart from orders order by placed_at`);
  assert.deepEqual(rows, [
    { source: 'qr', had_cart: true },
    { source: 'pos', had_cart: false },
  ]);
  assert.ok(placed.order.id);
});

test('a café is created with its owner\'s email, so the platform admin can reach them', async () => {
  const { createRestaurant } = await import('../src/services/signup.js');
  const made = await createRestaurant(db, { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', email: 'founder@example.com' }, {
    name: 'Founders Cafe',
    currency_code: 'INR',
    table_count: 0,
    display_name: 'Founder',
  });
  const { rows } = await db.query('select owner_email, trial_ends_at > now() + interval \'13 days\' as has_trial from restaurants where id = $1', [made.restaurantId]);
  assert.equal(rows[0].owner_email, 'founder@example.com');
  assert.equal(rows[0].has_trial, true, 'a new café starts with a 14-day trial');
  await db.query('delete from staff_members where user_id = $1', ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']);
});
