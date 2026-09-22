import { HttpError } from '../errors.js';

// The kitchen's view of orders. Every function takes the restaurant id from the
// signed-in staff member (req.staff.restaurantId), never from the request, so
// one café can't see another's orders.

// Mirrors the database trigger (enforce_order_status_transition) so the API can
// reject a bad move with a useful 409 BEFORE writing anything, instead of
// surfacing the trigger's generic constraint error. The trigger stays as the
// backstop — belt and suspenders — in case this table and the trigger ever
// drift apart.
export const ORDER_TRANSITIONS = {
  placed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served'],
  served: [],
  cancelled: [],
};

// GET /orders — the live board's initial load: orders that still need work,
// oldest first (the one that has waited longest is at the top of its column).
//
// Each order carries what a kitchen card needs: number, table, status, its
// lines with notes, and when it entered its CURRENT status (for "waiting 7
// min" and the stuck highlight). server_time lets the dashboard measure ages
// against the server's clock instead of the tablet's, which may be wrong.
//
// Served and cancelled orders are not here; they belong to GET /orders/recent.
export async function listActiveOrders(db, restaurantId, { status, tableId } = {}) {
  const { rows } = await db.query(
    `select o.id, o.order_number, o.status, o.total_amount, o.placed_at,
            -- The newest event (by its ever-increasing id, not by timestamp, which can tie)
            -- is the one that put the order in its current status.
            coalesce(
              (select e.created_at from public.order_status_events e
                where e.order_id = o.id order by e.id desc limit 1),
              o.placed_at
            ) as status_changed_at,
            t.id as table_id, t.label as table_label,
            coalesce(
              (select json_agg(
                        json_build_object(
                          'name', oi.name_at_order,
                          'quantity', oi.quantity,
                          'special_instructions', oi.special_instructions
                        )
                        order by oi.name_at_order, oi.id)
                 from public.order_items oi
                where oi.order_id = o.id),
              '[]'::json
            ) as items
       from public.orders o
       join public.restaurant_tables t on t.id = o.table_id
      where o.restaurant_id = $1
        -- Everything that still needs work, optionally narrowed to one status. The plain
        -- IN (not a CASE) lets the index on (restaurant_id, status, placed_at) use BOTH
        -- columns even with a reusable generic plan, so old served orders are never scanned.
        and o.status in ('placed', 'preparing', 'ready')
        and ($2::text is null or o.status::text = $2::text)
        and ($3::uuid is null or o.table_id = $3::uuid)
      order by o.placed_at, o.order_number`,
    [restaurantId, status ?? null, tableId ?? null],
  );

  return {
    server_time: new Date().toISOString(),
    orders: rows.map(({ table_id, table_label, ...order }) => ({
      ...order,
      table: { id: table_id, label: table_label },
    })),
  };
}

// GET /orders/recent — served/cancelled orders, for the Recent tab: "what did
// table 4 actually order", "did we already serve #1014", "why doesn't the
// till match" (something got cancelled).
//
// "Recent" is measured by when the order FINISHED (served or cancelled), not
// when it was placed — an order that sat waiting for a while should still show
// up right after it's finally served, rather than aging out while it waited.
// Newest first: the opposite of the board, where the longest-waiting order
// matters most; here it's the opposite: what just happened.
export async function getRecentOrders(db, restaurantId, { hours = 4 } = {}) {
  const { rows } = await db.query(
    `select o.id, o.order_number, o.status, o.total_amount, o.placed_at,
            fin.finished_at,
            t.id as table_id, t.label as table_label,
            coalesce(
              (select json_agg(
                        json_build_object(
                          'name', oi.name_at_order,
                          'quantity', oi.quantity,
                          'special_instructions', oi.special_instructions
                        )
                        order by oi.name_at_order, oi.id)
                 from public.order_items oi
                where oi.order_id = o.id),
              '[]'::json
            ) as items
       from public.orders o
       join public.restaurant_tables t on t.id = o.table_id
       -- The order's most recent status event IS when it finished: the last
       -- thing that can happen to a served or cancelled order is becoming
       -- served or cancelled. Same "newest by id" rule as the board query,
       -- computed once here so the filter and the sort agree with the value shown.
       join lateral (
         select e.created_at as finished_at
           from public.order_status_events e
          where e.order_id = o.id
          order by e.id desc
          limit 1
       ) fin on true
      where o.restaurant_id = $1
        and o.status in ('served', 'cancelled')
        and fin.finished_at >= now() - make_interval(hours => $2)
      order by fin.finished_at desc, o.order_number desc`,
    [restaurantId, hours],
  );

  return {
    server_time: new Date().toISOString(),
    orders: rows.map(({ table_id, table_label, ...order }) => ({
      ...order,
      table: { id: table_id, label: table_label },
    })),
  };
}

// GET /orders/:id — one order's full detail plus its status timeline, for a
// staff member who already has the id (a board card, a search, a link).
// Scoped to the signed-in staff member's restaurant, like every staff query:
// another café's order id must come back as "not found", not as a peek at
// their kitchen — so the restaurant check is IN the query, not a filter
// applied afterwards.
export async function getOrderDetail(db, restaurantId, orderId) {
  const { rows: orders } = await db.query(
    `select o.id, o.order_number, o.status, o.subtotal, o.tax_amount, o.total_amount,
            o.notes, o.placed_at, o.updated_at,
            t.id as table_id, t.label as table_label
       from public.orders o
       join public.restaurant_tables t on t.id = o.table_id
      where o.id = $1 and o.restaurant_id = $2`,
    [orderId, restaurantId],
  );
  if (!orders.length) return null;
  const { table_id, table_label, ...order } = orders[0];

  const [{ rows: items }, { rows: timeline }] = await Promise.all([
    db.query(
      `select name_at_order as name, price_at_order as price, quantity, special_instructions, line_total
         from public.order_items where order_id = $1 order by name_at_order, id`,
      [orderId],
    ),
    // Oldest first, so it reads top-to-bottom as a story: placed -> preparing -> ....
    // changed_by is null until the API starts passing an actor into
    // db.withTransaction (the status-update route, in the next piece of this slice).
    db.query(
      `select e.from_status, e.to_status, e.created_at, sm.display_name as changed_by
         from public.order_status_events e
         left join public.staff_members sm on sm.user_id = e.changed_by
        where e.order_id = $1
        order by e.id`,
      [orderId],
    ),
  ]);

  return { ...order, table: { id: table_id, label: table_label }, items, timeline };
}

// PATCH /orders/:id/status { status } — move an order forward.
//
// Two staff can tap the same order at once (one on a tablet, one on their
// phone). `for update` locks the order's row for the rest of the transaction,
// so the second request has to wait for the first to finish before it can
// even read the current status — there's no window where both see "placed"
// and both think their move is legal. Whichever request the database lets
// through first wins; the second sees the now-current status and is told
// plainly that it lost the race, with who got there first.
//
// Returns null for a made-up id or another café's order (the route turns
// that into a 404, same as GET /orders/:id). Throws a 409 for a move that
// isn't legal from wherever the order actually is right now — whether that's
// because two people tapped at once, or because the request just names a
// move that was never legal in the first place; either way, "here's what's
// actually true, go refresh" is the right answer.
export async function updateOrderStatus(db, restaurantId, orderId, targetStatus, actorId) {
  const result = await db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `select status from public.orders where id = $1 and restaurant_id = $2 for update`,
      [orderId, restaurantId],
    );
    if (!rows.length) return { outcome: 'not_found' };

    const currentStatus = rows[0].status;
    if (!ORDER_TRANSITIONS[currentStatus].includes(targetStatus)) {
      const { rows: last } = await tx.query(
        `select sm.display_name from public.order_status_events e
           left join public.staff_members sm on sm.user_id = e.changed_by
          where e.order_id = $1
          order by e.id desc limit 1`,
        [orderId],
      );
      return { outcome: 'conflict', currentStatus, changedBy: last[0]?.display_name ?? null };
    }

    await tx.query('update public.orders set status = $2 where id = $1', [orderId, targetStatus]);
    return { outcome: 'ok' };
  }, { actorId });

  if (result.outcome === 'not_found') return null;
  if (result.outcome === 'conflict') {
    const by = result.changedBy ? ` by ${result.changedBy}` : '';
    throw new HttpError(409, 'invalid_transition', `Order is already "${result.currentStatus}"${by} — refresh to see its current state`, {
      current_status: result.currentStatus,
      changed_by: result.changedBy,
    });
  }

  return getOrderDetail(db, restaurantId, orderId);
}
