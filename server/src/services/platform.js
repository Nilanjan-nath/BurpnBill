import { HttpError, notFound, badRequest } from '../errors.js';

// What BurpnBill itself needs to run as a business: how every café is doing, and
// who has paid. Used only by /api/admin/* (owner of the platform, never a café).
// It is the one place in the API that reads ACROSS cafés, so nothing here takes a
// restaurant id from a café user, and routes/admin.js sits behind its own check.

// India has one time zone and no daylight saving, and the platform owner thinks in
// it. A "month" is an IST month: an order at 02:00 IST on the 1st belongs to the
// new month even though it is still the 30th in UTC.
const TZ = 'Asia/Kolkata';

export const PLAN_MONTHS = 6;
export const PLAN_PRICE = '1499.00';
export const GRACE_DAYS = 3;
const DAY_MS = 86_400_000;

// An order only counts once the counter has accepted it (approved_at), and not if
// it was cancelled or rejected: the same definition the café's own dashboard uses,
// so the numbers here and the café's own screen cannot disagree.
const COUNTED = `o.approved_at is not null and o.status <> 'cancelled'`;

// --- plan state ---------------------------------------------------------------
//
// Derived from two dates and the clock, never stored, so it cannot go stale:
//   active    paid_until is in the future
//   trialing  the free trial has not ended
//   grace     it ended, but less than GRACE_DAYS ago
//   locked    past grace. NOTHING is locked yet: this is shown to the admin only.
export function planState({ trial_ends_at, paid_until }, now = new Date()) {
  const trialEnd = new Date(trial_ends_at);
  const paidEnd = paid_until ? new Date(paid_until) : null;
  const t = now.getTime();
  const daysUntil = (d) => Math.ceil((d.getTime() - t) / DAY_MS);

  if (paidEnd && paidEnd.getTime() > t) {
    return { state: 'active', ends_at: paidEnd.toISOString(), days_left: daysUntil(paidEnd) };
  }
  if (trialEnd.getTime() > t) {
    return { state: 'trialing', ends_at: trialEnd.toISOString(), days_left: daysUntil(trialEnd) };
  }
  const lapsedAt = new Date(Math.max(trialEnd.getTime(), paidEnd?.getTime() ?? 0));
  const lockAt = new Date(lapsedAt.getTime() + GRACE_DAYS * DAY_MS);
  if (t < lockAt.getTime()) {
    return { state: 'grace', ends_at: lockAt.toISOString(), days_left: daysUntil(lockAt) };
  }
  return { state: 'locked', ends_at: lockAt.toISOString(), days_left: 0 };
}

// --- money, in whole paise ----------------------------------------------------
const toPaise = (v) => Math.round(Number(v ?? 0) * 100);
const fromPaise = (p) => `${p < 0 ? '-' : ''}${Math.trunc(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, '0')}`;

// --- months -------------------------------------------------------------------

// 'YYYY-MM' for the current IST month, from the database's clock.
async function currentMonth(db) {
  const { rows } = await db.query(`select to_char(now() at time zone '${TZ}', 'YYYY-MM') as m`);
  return rows[0].m;
}

async function monthOrCurrent(db, month) {
  return month ?? (await currentMonth(db));
}

async function previousMonthOf(db, month) {
  const { rows } = await db.query(`select to_char(($1 || '-01')::date - interval '1 month', 'YYYY-MM') as m`, [month]);
  return rows[0].m;
}

// --- overview -----------------------------------------------------------------

// GET /admin/overview — the headline numbers: how many cafés, in which state, who
// needs a call, and what has been received this month.
export async function getOverview(db, now = new Date()) {
  const month = await currentMonth(db);
  const [{ rows: cafes }, { rows: money }, { rows: signups }, { rows: activity }] = await Promise.all([
    db.query(`select id, name, owner_email, created_at, trial_ends_at, paid_until from public.restaurants order by created_at`),
    db.query(
      `select coalesce(sum(amount), 0)::numeric(12, 2) as received, count(*)::int as payments
         from public.subscription_payments
        where to_char(paid_on, 'YYYY-MM') = $1`,
      [month],
    ),
    db.query(
      `select to_char(date_trunc('week', created_at at time zone '${TZ}'), 'YYYY-MM-DD') as week, count(*)::int as cafes
         from public.restaurants
        where created_at >= now() - interval '8 weeks'
        group by 1 order by 1`,
    ),
    // Has each café actually been using it this month? Drives "trials with no orders".
    db.query(
      `select o.restaurant_id, count(*)::int as orders
         from public.orders o
        where ${COUNTED} and o.placed_at >= (($1 || '-01')::timestamp at time zone '${TZ}')
        group by o.restaurant_id`,
      [month],
    ),
  ]);

  const ordersByCafe = new Map(activity.map((r) => [r.restaurant_id, r.orders]));
  const counts = { trialing: 0, active: 0, grace: 0, locked: 0 };
  const trialsEndingSoon = [];
  const plansExpiringSoon = [];
  const trialsWithNoOrders = [];
  for (const c of cafes) {
    const plan = planState(c, now);
    counts[plan.state] += 1;
    const brief = { id: c.id, name: c.name, owner_email: c.owner_email, ends_at: plan.ends_at, days_left: plan.days_left };
    if (plan.state === 'trialing' && plan.days_left <= 7) trialsEndingSoon.push(brief);
    if (plan.state === 'active' && plan.days_left <= 14) plansExpiringSoon.push(brief);
    if (plan.state === 'trialing' && !ordersByCafe.get(c.id)) trialsWithNoOrders.push(brief);
  }

  return {
    month,
    cafes: cafes.length,
    states: counts,
    received_this_month: money[0].received,
    payments_this_month: money[0].payments,
    signups_by_week: signups,
    trials_ending_soon: trialsEndingSoon,
    plans_expiring_soon: plansExpiringSoon,
    trials_with_no_orders: trialsWithNoOrders,
  };
}

// --- the monthly report -------------------------------------------------------

// The per-café numbers for one month. Both months in one pass so the comparison
// is computed by the same query that computed the figure it is compared with.
//   sales        money actually taken: settled bills in the month (by settled_at)
//   order_value  everything ordered and accepted, including tables not yet settled
// They are different questions: one is what the café banked, the other is how busy
// it was.
async function monthFigures(db, month) {
  const { rows } = await db.query(
    `with w as (
       select ($1 || '-01')::timestamp                                          as m0,
              (($1 || '-01')::timestamp at time zone '${TZ}')                   as cur_start,
              ((($1 || '-01')::timestamp + interval '1 month') at time zone '${TZ}') as cur_end,
              ((($1 || '-01')::timestamp - interval '1 month') at time zone '${TZ}') as prev_start
     ), ord as (
       select o.restaurant_id,
              count(*) filter (where ${COUNTED} and o.source = 'qr'  and o.placed_at >= w.cur_start and o.placed_at < w.cur_end)::int  as qr_orders,
              count(*) filter (where ${COUNTED} and o.source = 'pos' and o.placed_at >= w.cur_start and o.placed_at < w.cur_end)::int  as pos_orders,
              coalesce(sum(o.total_amount) filter (where ${COUNTED} and o.source = 'qr'  and o.placed_at >= w.cur_start and o.placed_at < w.cur_end), 0)::numeric(12, 2) as qr_value,
              coalesce(sum(o.total_amount) filter (where ${COUNTED} and o.source = 'pos' and o.placed_at >= w.cur_start and o.placed_at < w.cur_end), 0)::numeric(12, 2) as pos_value,
              count(*) filter (where o.status = 'cancelled' and o.placed_at >= w.cur_start and o.placed_at < w.cur_end)::int           as cancelled,
              count(*) filter (where ${COUNTED} and o.placed_at >= w.prev_start and o.placed_at < w.cur_start)::int                    as prev_orders,
              coalesce(sum(o.total_amount) filter (where ${COUNTED} and o.placed_at >= w.prev_start and o.placed_at < w.cur_start), 0)::numeric(12, 2) as prev_value
         from public.orders o, w
        where o.placed_at >= w.prev_start and o.placed_at < w.cur_end
        group by o.restaurant_id
     ), bil as (
       select b.restaurant_id,
              coalesce(sum(b.total_amount) filter (where b.settled_at >= w.cur_start and b.settled_at < w.cur_end), 0)::numeric(12, 2)  as sales,
              count(*) filter (where b.settled_at >= w.cur_start and b.settled_at < w.cur_end)::int                                    as bills,
              coalesce(sum(b.total_amount) filter (where b.settled_at >= w.prev_start and b.settled_at < w.cur_start), 0)::numeric(12, 2) as prev_sales
         from public.bills b, w
        where b.settled_at >= w.prev_start and b.settled_at < w.cur_end
        group by b.restaurant_id
     ), lastorder as (
       select o.restaurant_id, max(o.placed_at) as last_order_at
         from public.orders o where ${COUNTED} group by o.restaurant_id
     )
     select r.id, r.name, r.owner_email, r.created_at, r.trial_ends_at, r.paid_until,
            coalesce(ord.qr_orders, 0)  as qr_orders,  coalesce(ord.pos_orders, 0) as pos_orders,
            coalesce(ord.qr_value, 0)::numeric(12, 2)   as qr_value,   coalesce(ord.pos_value, 0)::numeric(12, 2)  as pos_value,
            coalesce(ord.cancelled, 0)  as cancelled,
            coalesce(ord.prev_orders, 0) as prev_orders, coalesce(ord.prev_value, 0)::numeric(12, 2) as prev_value,
            coalesce(bil.sales, 0)::numeric(12, 2)      as sales,      coalesce(bil.bills, 0)      as bills,
            coalesce(bil.prev_sales, 0)::numeric(12, 2) as prev_sales,
            lastorder.last_order_at
       from public.restaurants r
       left join ord  on ord.restaurant_id  = r.id
       left join bil  on bil.restaurant_id  = r.id
       left join lastorder on lastorder.restaurant_id = r.id
      order by coalesce(bil.sales, 0) desc, r.name`,
    [month],
  );
  return rows;
}

const percentChange = (now, before) => {
  if (!(before > 0)) return null; // "+100% vs nothing" is noise
  return Math.round(((now - before) / before) * 1000) / 10;
};

function shapeCafe(row, now) {
  const orders = row.qr_orders + row.pos_orders;
  const orderValue = toPaise(row.qr_value) + toPaise(row.pos_value);
  const sales = toPaise(row.sales);
  return {
    id: row.id,
    name: row.name,
    owner_email: row.owner_email,
    created_at: row.created_at,
    plan: planState(row, now),
    last_order_at: row.last_order_at,
    qr_orders: row.qr_orders,
    pos_orders: row.pos_orders,
    orders,
    qr_value: row.qr_value,
    pos_value: row.pos_value,
    order_value: fromPaise(orderValue),
    sales: row.sales,
    bills: row.bills,
    // Averages are null, never 0, when there is nothing to average.
    average_order: orders ? fromPaise(Math.round(orderValue / orders)) : null,
    cancelled: row.cancelled,
    previous: { orders: row.prev_orders, order_value: row.prev_value, sales: row.prev_sales },
    change: {
      orders: percentChange(orders, row.prev_orders),
      sales: percentChange(sales, toPaise(row.prev_sales)),
    },
  };
}

// GET /admin/report?month=YYYY-MM
export async function getMonthlyReport(db, month, now = new Date()) {
  const m = await monthOrCurrent(db, month);
  const [rows, prev] = await Promise.all([monthFigures(db, m), previousMonthOf(db, m)]);
  const cafes = rows.map((r) => shapeCafe(r, now));

  const sum = (pick) => cafes.reduce((acc, c) => acc + pick(c), 0);
  const totalOrders = sum((c) => c.orders);
  const totalValue = sum((c) => toPaise(c.order_value));
  const totalSales = sum((c) => toPaise(c.sales));
  const prevSales = sum((c) => toPaise(c.previous.sales));
  const prevOrders = sum((c) => c.previous.orders);
  return {
    month: m,
    previous_month: prev,
    cafes,
    totals: {
      cafes: cafes.length,
      qr_orders: sum((c) => c.qr_orders),
      pos_orders: sum((c) => c.pos_orders),
      orders: totalOrders,
      qr_value: fromPaise(sum((c) => toPaise(c.qr_value))),
      pos_value: fromPaise(sum((c) => toPaise(c.pos_value))),
      order_value: fromPaise(totalValue),
      sales: fromPaise(totalSales),
      bills: sum((c) => c.bills),
      average_order: totalOrders ? fromPaise(Math.round(totalValue / totalOrders)) : null,
      cancelled: sum((c) => c.cancelled),
      previous: { orders: prevOrders, order_value: fromPaise(sum((c) => toPaise(c.previous.order_value))), sales: fromPaise(prevSales) },
      change: { orders: percentChange(totalOrders, prevOrders), sales: percentChange(totalSales, prevSales) },
    },
  };
}

// --- one café -----------------------------------------------------------------

// GET /admin/restaurants — the list: who they are, where their plan stands, and
// whether they are using it (last order, and the last 30 days).
export async function listRestaurants(db, now = new Date()) {
  const { rows } = await db.query(
    `select r.id, r.name, r.owner_email, r.created_at, r.trial_ends_at, r.paid_until,
            (select max(o.placed_at) from public.orders o where o.restaurant_id = r.id and ${COUNTED}) as last_order_at,
            (select count(*)::int from public.orders o
              where o.restaurant_id = r.id and ${COUNTED} and o.placed_at >= now() - interval '30 days') as orders_30d,
            (select coalesce(sum(b.total_amount), 0)::numeric(12, 2) from public.bills b
              where b.restaurant_id = r.id and b.settled_at >= now() - interval '30 days') as sales_30d,
            (select count(*)::int from public.staff_members sm where sm.restaurant_id = r.id) as team_size
       from public.restaurants r
      order by r.created_at desc`,
  );
  return rows.map(({ trial_ends_at, paid_until, ...r }) => ({
    ...r,
    trial_ends_at,
    paid_until,
    plan: planState({ trial_ends_at, paid_until }, now),
  }));
}

// GET /admin/restaurants/:id?month= — one café: its profile, plan, payments, and a
// day-by-day look at the month (QR vs counter, and money taken).
export async function getRestaurantDetail(db, restaurantId, month, now = new Date()) {
  const m = await monthOrCurrent(db, month);
  const { rows: cafe } = await db.query(
    `select id, name, address, phone, owner_email, created_at, trial_ends_at, paid_until, is_active,
            (select count(*)::int from public.staff_members sm where sm.restaurant_id = r.id) as team_size,
            (select count(*)::int from public.restaurant_tables t where t.restaurant_id = r.id) as tables
       from public.restaurants r where id = $1`,
    [restaurantId],
  );
  if (!cafe.length) throw notFound('Café not found');

  const [{ rows: daily }, { rows: payments }, { rows: events }, report] = await Promise.all([
    db.query(
      `with w as (select ($2 || '-01')::date as d0)
       select to_char(d, 'YYYY-MM-DD') as day,
              coalesce(o.qr_orders, 0)  as qr_orders,
              coalesce(o.pos_orders, 0) as pos_orders,
              coalesce(b.sales, 0)::numeric(12, 2) as sales
         from w, generate_series(w.d0, (w.d0 + interval '1 month' - interval '1 day')::date, interval '1 day') as d
         left join (
           select (o.placed_at at time zone '${TZ}')::date as day,
                  count(*) filter (where o.source = 'qr')::int  as qr_orders,
                  count(*) filter (where o.source = 'pos')::int as pos_orders
             from public.orders o
            where o.restaurant_id = $1 and ${COUNTED}
            group by 1) o on o.day = d::date
         left join (
           select (b.settled_at at time zone '${TZ}')::date as day, sum(b.total_amount) as sales
             from public.bills b where b.restaurant_id = $1 group by 1) b on b.day = d::date
        order by d`,
      [restaurantId, m],
    ),
    db.query(
      `select id, invoice_seq, amount, currency_code, method, reference, paid_on, plan_months, period_start, period_end, note, created_at
         from public.subscription_payments where restaurant_id = $1 order by created_at desc`,
      [restaurantId],
    ),
    db.query(
      `select kind, data, created_at from public.subscription_events where restaurant_id = $1 order by created_at desc limit 20`,
      [restaurantId],
    ),
    getMonthlyReport(db, m, now),
  ]);

  const { trial_ends_at, paid_until } = cafe[0];
  return {
    cafe: { ...cafe[0], plan: planState({ trial_ends_at, paid_until }, now) },
    month: m,
    figures: report.cafes.find((c) => c.id === restaurantId) ?? null,
    daily,
    payments: payments.map((p) => ({ ...p, invoice_number: invoiceNumber(p.invoice_seq) })),
    events,
    plan_defaults: { months: PLAN_MONTHS, amount: PLAN_PRICE },
  };
}

// --- payments and the invoice -------------------------------------------------

export const invoiceNumber = (seq) => `BNB-${String(seq).padStart(4, '0')}`;

// POST /admin/restaurants/:id/payments — record money that has ALREADY arrived.
//
// One transaction, with the café's row locked, so two admin tabs recording at once
// cannot both extend from the same starting point.
//
// The paid period starts at whichever is latest: now, the end of the free trial, or
// the end of the plan they are already on. Paying on day 10 of a 14-day trial buys
// six months from day 14, not from day 10: nobody loses trial days by paying early,
// and a renewal stacks on the end of the current plan instead of overlapping it.
export async function recordPayment(db, adminId, restaurantId, input, seller) {
  try {
    return await db.withTransaction(async (tx) => {
      const { rows: cafe } = await tx.query(
        `select id, name, address, phone, owner_email, trial_ends_at, paid_until
           from public.restaurants where id = $1 for update`,
        [restaurantId],
      );
      if (!cafe.length) throw notFound('Café not found');

      const months = input.months ?? PLAN_MONTHS;
      const { rows: today } = await tx.query(`select to_char(now() at time zone '${TZ}', 'YYYY-MM-DD') as d`);
      const paidOn = input.paid_on ?? today[0].d;
      if (paidOn > today[0].d) throw badRequest('The payment date cannot be in the future');

      const snapshot = {
        restaurant: { id: cafe[0].id, name: cafe[0].name, address: cafe[0].address, phone: cafe[0].phone, email: cafe[0].owner_email },
        seller,
      };
      const { rows } = await tx.query(
        `insert into public.subscription_payments
           (restaurant_id, amount, method, reference, paid_on, plan_months, period_start, period_end, note, snapshot, recorded_by)
         select $1, $2, $3, $4, $5::date, $6, s.start_at, s.start_at + make_interval(months => $6), $7, $8::jsonb, $9
           from (select greatest(now(), $10::timestamptz, coalesce($11::timestamptz, now())) as start_at) s
         returning id, invoice_seq, amount, method, reference, paid_on, plan_months, period_start, period_end`,
        [
          restaurantId,
          input.amount,
          input.method,
          input.reference ?? null,
          paidOn,
          months,
          input.note ?? null,
          JSON.stringify(snapshot),
          adminId,
          cafe[0].trial_ends_at,
          cafe[0].paid_until,
        ],
      );
      const payment = rows[0];

      await tx.query(`update public.restaurants set paid_until = $2, updated_at = now() where id = $1`, [restaurantId, payment.period_end]);
      await tx.query(
        `insert into public.subscription_events (restaurant_id, kind, data, created_by) values ($1, 'payment_recorded', $2::jsonb, $3)`,
        [restaurantId, JSON.stringify({ payment_id: payment.id, amount: payment.amount, months, invoice: invoiceNumber(payment.invoice_seq) }), adminId],
      );

      return {
        payment: { ...payment, invoice_number: invoiceNumber(payment.invoice_seq) },
        plan: planState({ trial_ends_at: cafe[0].trial_ends_at, paid_until: payment.period_end }),
      };
    });
  } catch (err) {
    if (err.constraint === 'subscription_payments_reference_key' || /subscription_payments_reference_key/.test(err.message ?? '')) {
      throw new HttpError(409, 'duplicate_reference', 'That payment reference is already recorded. If it is a new payment, check the reference.');
    }
    throw err;
  }
}

// POST /admin/restaurants/:id/extend-trial — more days from the later of now and
// the current end, so extending a lapsed trial gives days from today, not from
// some date in the past.
export async function extendTrial(db, adminId, restaurantId, days) {
  return db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `update public.restaurants
          set trial_ends_at = greatest(trial_ends_at, now()) + make_interval(days => $2), updated_at = now()
        where id = $1
        returning trial_ends_at, paid_until`,
      [restaurantId, days],
    );
    if (!rows.length) throw notFound('Café not found');
    await tx.query(
      `insert into public.subscription_events (restaurant_id, kind, data, created_by) values ($1, 'trial_extended', $2::jsonb, $3)`,
      [restaurantId, JSON.stringify({ days, trial_ends_at: rows[0].trial_ends_at }), adminId],
    );
    return { trial_ends_at: rows[0].trial_ends_at, plan: planState(rows[0]) };
  });
}

// GET /admin/payments/:id/invoice — what the printable invoice shows, read from
// the frozen snapshot so a reprint never changes.
export async function getInvoice(db, paymentId) {
  const { rows } = await db.query(
    `select id, invoice_seq, amount, currency_code, method, reference, paid_on, plan_months, period_start, period_end, snapshot, created_at
       from public.subscription_payments where id = $1`,
    [paymentId],
  );
  if (!rows.length) throw notFound('Invoice not found');
  const p = rows[0];
  return {
    invoice: {
      number: invoiceNumber(p.invoice_seq),
      issued_on: p.created_at,
      paid_on: p.paid_on,
      seller: p.snapshot.seller,
      buyer: p.snapshot.restaurant,
      description: `BurpnBill plan, ${p.plan_months} ${p.plan_months === 1 ? 'month' : 'months'}`,
      period_start: p.period_start,
      period_end: p.period_end,
      amount: p.amount,
      currency_code: p.currency_code,
      method: p.method,
      reference: p.reference,
    },
  };
}
