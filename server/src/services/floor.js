// GET /floor (step 7 slice 2, POS) — every table plus whether it's occupied.
// No new schema: occupancy means "has an unpaid, non-cancelled order right
// now" — not just "the kitchen still has work to do". A table stays occupied
// through 'served' (the group is very likely still sitting there) and only
// frees up once someone checks it out (POST /tables/:id/checkout marks its
// orders paid) or every order on it is cancelled. A table can have at most
// one such order in practice, but the query takes the newest just in case.
export async function getFloor(db, restaurantId) {
  const { rows } = await db.query(
    `select t.id, t.label, t.seats, t.is_active, t.qr_token,
            o.id as order_id, o.order_number, o.status, o.placed_at,
            b.unpaid_count, b.unpaid_total
       from public.restaurant_tables t
       left join lateral (
         select id, order_number, status, placed_at
           from public.orders
          where table_id = t.id and paid_at is null and status != 'cancelled'
          order by placed_at desc
          limit 1
       ) o on true
       -- The running bill is every unpaid order on the table, not just the
       -- newest one above: a table that ordered a second round owes for both.
       left join lateral (
         select count(*)::int                                 as unpaid_count,
                coalesce(sum(total_amount), 0)::numeric(12, 2) as unpaid_total
           from public.orders
          where table_id = t.id and paid_at is null and status != 'cancelled'
            -- Not yet accepted, so not yet owed for. Occupancy above still
            -- counts it: the guests are at the table either way.
            and approved_at is not null
       ) b on true
      where t.restaurant_id = $1
      order by t.created_at`,
    [restaurantId],
  );

  return {
    tables: rows.map(({ order_id, order_number, status, placed_at, unpaid_count, unpaid_total, ...table }) => ({
      ...table,
      status: order_id ? 'occupied' : 'free',
      active_order: order_id ? { id: order_id, order_number, status, placed_at } : null,
      unpaid_count,
      unpaid_total,
    })),
  };
}
