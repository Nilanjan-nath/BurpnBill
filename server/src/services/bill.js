// GET /bill — a read-only summary of what THIS guest session has ordered, for
// showing to the cashier before paying at the counter. It is not an invoice
// and takes no payment.
//
// Scope is the guest session, not the table: two people at one table each see
// only their own orders, and nobody who merely knows the table's QR link can
// read what other guests ordered. (A joint table bill is a staff-side feature.)
//
// Cancelled orders are listed (so the customer can see why an order isn't
// charged) but left out of the totals. The API doesn't expose order status
// beyond that: customer-facing order tracking is out of scope for v1.
export async function getBill(db, guest) {
  const [{ rows: head }, { rows: orders }, { rows: items }, { rows: totals }] = await Promise.all([
    db.query(
      `select r.name as restaurant_name, r.currency_code, t.label as table_label
         from public.restaurant_tables t
         join public.restaurants r on r.id = t.restaurant_id
        where t.id = $1`,
      [guest.tableId],
    ),
    db.query(
      `select id, order_number, (status = 'cancelled') as cancelled,
              subtotal, tax_amount, total_amount, placed_at
         from public.orders
        where guest_session_id = $1
        order by placed_at, order_number`,
      [guest.sessionId],
    ),
    db.query(
      `select oi.order_id, oi.name_at_order as name, oi.price_at_order as price,
              oi.quantity, oi.special_instructions, oi.line_total
         from public.order_items oi
         join public.orders o on o.id = oi.order_id
        where o.guest_session_id = $1
        order by oi.name_at_order, oi.id`,
      [guest.sessionId],
    ),
    db.query(
      `select coalesce(sum(subtotal), 0)::numeric(12, 2)     as subtotal,
              coalesce(sum(tax_amount), 0)::numeric(12, 2)   as tax,
              coalesce(sum(total_amount), 0)::numeric(12, 2) as total
         from public.orders
        where guest_session_id = $1 and status <> 'cancelled'`,
      [guest.sessionId],
    ),
  ]);

  return {
    restaurant: { name: head[0].restaurant_name, currency_code: head[0].currency_code },
    table: { label: head[0].table_label },
    generated_at: new Date().toISOString(),
    orders: orders.map((order) => ({
      ...order,
      items: items
        .filter((item) => item.order_id === order.id)
        .map(({ order_id: _orderId, ...item }) => item),
    })),
    totals: totals[0],
  };
}
