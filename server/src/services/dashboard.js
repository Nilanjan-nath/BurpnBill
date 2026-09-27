// GET /dashboard/summary — the owner's "how is today going" screen.
//
// Everything here is derived from orders, tables and the menu as they already
// are. No new schema, and nothing is reported that isn't really known: there
// is no stock count, no clock-in, and no waitlist in this product, so there
// are no tiles pretending otherwise.
//
// "Today" is the CAFE's day, not the database's. Postgres runs in UTC, where
// the day rolls over at 05:30 IST — halfway through a morning shift. The
// caller passes its own IANA zone and the boundary is computed in it. The
// zone is resolved against pg_timezone_names with a UTC fallback, so a
// nonsense value degrades instead of erroring.
export async function getDashboardSummary(db, restaurantId, timeZone) {
  const tz = [restaurantId, timeZone ?? 'UTC'];

  // date_trunc in local time, then back to timestamptz: midnight where the
  // cafe is, expressed as the absolute instant the columns are stored in.
  const DAY_START = `(
    select date_trunc('day', now() at time zone z.name) at time zone z.name
      from (select coalesce((select name from pg_timezone_names where name = $2), 'UTC') as name) z
  )`;

  const [
    { rows: money },
    { rows: counts },
    { rows: floor },
    { rows: prep },
    { rows: best },
    { rows: hourly },
    { rows: yesterday },
    { rows: week },
    { rows: payments },
    { rows: channel },
    { rows: team },
  ] = await Promise.all([
      // Taken vs still owed are deliberately separate numbers. One is money in
      // the till; the other is money sitting on tables. Summing them into a
      // single "revenue" would be a number nobody could act on.
      db.query(
        `select coalesce(sum(total_amount) filter (where paid_at >= ${DAY_START}), 0)::numeric(12, 2) as taken_today,
                count(*) filter (where paid_at >= ${DAY_START})::int                                  as paid_orders_today,
                coalesce(sum(total_amount) filter (
                  where paid_at is null and approved_at is not null and status <> 'cancelled'
                ), 0)::numeric(12, 2)                                                                 as open_on_tables,
                count(*) filter (
                  where placed_at >= ${DAY_START} and approved_at is not null and status <> 'cancelled'
                )::int                                                                                as orders_today,
                coalesce(sum(total_amount) filter (
                  where placed_at >= ${DAY_START} and approved_at is not null and status <> 'cancelled'
                ), 0)::numeric(12, 2)                                                                 as ordered_today,
                count(*) filter (where placed_at >= ${DAY_START} and status = 'cancelled')::int        as cancelled_today
           from public.orders
          where restaurant_id = $1`,
        tz,
      ),
      // What the kitchen is holding right now, plus the QR queue in front of it.
      db.query(
        `select count(*) filter (where approved_at is null and status = 'placed')::int   as awaiting_approval,
                count(*) filter (where approved_at is not null and status = 'placed')::int     as placed,
                count(*) filter (where approved_at is not null and status = 'preparing')::int  as preparing,
                count(*) filter (where approved_at is not null and status = 'ready')::int      as ready
           from public.orders
          where restaurant_id = $1 and status not in ('served', 'cancelled')`,
        [restaurantId],
      ),
      // Same definition of "occupied" the floor map uses — an unpaid,
      // non-cancelled order on the table — so the two screens can't disagree.
      db.query(
        `select count(*)::int as total,
                count(*) filter (where exists (
                  select 1 from public.orders o
                   where o.table_id = t.id and o.paid_at is null and o.status <> 'cancelled'
                ))::int as occupied
           from public.restaurant_tables t
          where t.restaurant_id = $1 and t.is_active`,
        [restaurantId],
      ),
      // Kitchen-to-ready, over orders that actually got there today. Measured
      // from the 'preparing' event rather than from placing, so it's the
      // kitchen's own time and not time an order spent waiting to be accepted.
      db.query(
        `select avg(extract(epoch from (ready.created_at - prep.created_at)) / 60)::numeric(10, 1) as avg_prep_minutes,
                count(*)::int as sampled
           from public.orders o
           join lateral (
             select min(created_at) as created_at from public.order_status_events
              where order_id = o.id and to_status = 'preparing'
           ) prep on true
           join lateral (
             select min(created_at) as created_at from public.order_status_events
              where order_id = o.id and to_status = 'ready'
           ) ready on true
          where o.restaurant_id = $1
            and ready.created_at >= ${DAY_START}
            and prep.created_at is not null
            and ready.created_at > prep.created_at`,
        tz,
      ),
      db.query(
        `select oi.name_at_order as name, sum(oi.quantity)::int as quantity
           from public.order_items oi
           join public.orders o on o.id = oi.order_id
          where o.restaurant_id = $1
            and o.placed_at >= ${DAY_START}
            and o.approved_at is not null
            and o.status <> 'cancelled'
          group by oi.name_at_order
          order by quantity desc, name
          limit 3`,
        tz,
      ),
      // Sales by hour, on placed_at rather than paid_at: the question is when
      // the café is busy — useful for staffing — not when money was banked,
      // which lags and would make a busy unpaid hour look empty.
      db.query(
        `select extract(hour from (o.placed_at at time zone z.name))::int as hour,
                count(*)::int                                            as orders,
                coalesce(sum(o.total_amount), 0)::numeric(12, 2)         as value
           from public.orders o,
                (select coalesce((select name from pg_timezone_names where name = $2), 'UTC') as name) z
          where o.restaurant_id = $1
            and o.placed_at >= ${DAY_START}
            and o.approved_at is not null
            and o.status <> 'cancelled'
          group by 1
          order by 1`,
        tz,
      ),
      // Yesterday to the SAME time of day. Comparing a half-finished day
      // against a whole one would show a fall every morning.
      db.query(
        `select coalesce(sum(total_amount), 0)::numeric(12, 2) as takings,
                count(*)::int                                  as orders
           from public.orders
          where restaurant_id = $1
            and approved_at is not null and status <> 'cancelled'
            and placed_at >= ${DAY_START} - interval '1 day'
            and placed_at < ${DAY_START} - interval '1 day' + (now() - ${DAY_START})`,
        tz,
      ),
      // The last seven days including today, so the chart has a shape.
      db.query(
        `select (o.placed_at at time zone z.name)::date::text     as day,
                count(*)::int                                     as orders,
                coalesce(sum(o.total_amount), 0)::numeric(12, 2)  as value
           from public.orders o,
                (select coalesce((select name from pg_timezone_names where name = $2), 'UTC') as name) z
          where o.restaurant_id = $1
            and o.approved_at is not null and o.status <> 'cancelled'
            and o.placed_at >= ${DAY_START} - interval '6 days'
          group by 1
          order by 1`,
        tz,
      ),
      // How people actually paid. payments.method is the real record — see
      // services/tables.js — so this needs no guesswork.
      db.query(
        `select method::text as method, count(*)::int as count, coalesce(sum(amount), 0)::numeric(12, 2) as amount
           from public.payments
          where restaurant_id = $1 and status = 'succeeded' and created_at >= ${DAY_START}
          group by method
          order by amount desc`,
        tz,
      ),
      // QR vs counter, INFERRED rather than declared: a customer's order is
      // converted from a cart, a POS order never has one (see placeStaffOrder).
      // `orders.source` was deliberately not added — TASKS.md step 6 slice 3 —
      // and this is why it hasn't been needed.
      db.query(
        `select coalesce(sum(total_amount) filter (where cart_id is not null), 0)::numeric(12, 2) as qr_value,
                count(*) filter (where cart_id is not null)::int                                  as qr_orders,
                coalesce(sum(total_amount) filter (where cart_id is null), 0)::numeric(12, 2)     as counter_value,
                count(*) filter (where cart_id is null)::int                                      as counter_orders
           from public.orders
          where restaurant_id = $1
            and placed_at >= ${DAY_START}
            and approved_at is not null and status <> 'cancelled'`,
        tz,
      ),
      db.query(
        `select (select name from public.restaurants where id = $1) as restaurant_name,
                (select count(*) from public.staff_members where restaurant_id = $1)::int as members,
                (select count(*) from public.menu_items
                  where restaurant_id = $1 and deleted_at is null and not is_available)::int as unavailable_items`,
        [restaurantId],
      ),
    ]);

  const m = money[0];
  const ordersToday = m.orders_today;

  return {
    generated_at: new Date().toISOString(),
    money: {
      taken_today: m.taken_today,
      paid_orders_today: m.paid_orders_today,
      open_on_tables: m.open_on_tables,
      orders_today: ordersToday,
      ordered_today: m.ordered_today,
      // Per ticket across everything ordered today, settled or not — the
      // question is "what is a table worth", not "what have we banked". null
      // rather than 0 when there are no orders: zero would read as a real
      // average of zero-value tickets.
      average_order: ordersToday === 0 ? null : (Number(m.ordered_today) / ordersToday).toFixed(2),
      cancelled_today: m.cancelled_today,
    },
    kitchen: counts[0],
    tables: floor[0],
    // null when nothing reached 'ready' today — an average of no orders is not
    // zero minutes, and showing 0 would read as "instant".
    prep: { average_minutes: prep[0].sampled === 0 ? null : Number(prep[0].avg_prep_minutes), sampled: prep[0].sampled },
    best_sellers: best,
    // Every hour of the day, zero-filled, so the chart has an x-axis even
    // before the café opens and gaps read as quiet rather than missing.
    hourly: Array.from({ length: 24 }, (_, hour) => {
      const row = hourly.find((h) => h.hour === hour);
      return { hour, orders: row?.orders ?? 0, value: row?.value ?? '0.00' };
    }),
    yesterday: yesterday[0],
    last_7_days: week,
    payment_mix: payments,
    channel_mix: channel[0],
    restaurant: { name: team[0].restaurant_name },
    team: { members: team[0].members, unavailable_items: team[0].unavailable_items },
  };
}
