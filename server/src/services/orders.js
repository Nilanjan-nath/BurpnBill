import { HttpError, badRequest, notFound } from '../errors.js';

// POST /orders { cart_id }
//
// Turns a cart into an order in ONE transaction, and does so at most once per
// cart. The request names the cart on purpose: a retry or double-tap names the
// same cart, finds it already converted, and gets the same order back (200)
// instead of a duplicate. The first request gets 201.
//
// Locking:
//   - the cart row is locked `for update`, so concurrent requests queue up
//   - the menu rows are locked `for share`, so staff can't 86 an item between
//     our availability check and our commit (their update waits for us)
// Prices come from menu_items now, never from the client, and are copied onto
// the order so later menu edits can't rewrite history.
export function placeOrder(db, guest, { cart_id }) {
  return db.withTransaction(async (tx) => {
    const { rows: carts } = await tx.query(
      `select id, status from public.carts where id = $1 and guest_session_id = $2 for update`,
      [cart_id, guest.sessionId],
    );
    const cart = carts[0];
    if (!cart) throw notFound('Cart not found');

    if (cart.status === 'converted') {
      const { rows } = await tx.query('select id from public.orders where cart_id = $1', [cart.id]);
      return { order: await readOrder(tx, rows[0].id), created: false };
    }
    if (cart.status !== 'open') throw new HttpError(409, 'cart_closed', 'This cart is no longer active');

    const { rows: lines } = await tx.query(
      `select ci.id as cart_item_id, mi.name,
              (mi.is_available and mi.deleted_at is null and mi.restaurant_id = $2) as orderable
         from public.cart_items ci
         join public.menu_items mi on mi.id = ci.menu_item_id
        where ci.cart_id = $1
        for share of mi`,
      [cart.id, guest.restaurantId],
    );
    if (!lines.length) throw badRequest('Your cart is empty');

    const unavailable = lines.filter((l) => !l.orderable);
    if (unavailable.length) {
      // Nothing has been written yet. The app shows these lines, the customer
      // removes them, and confirms again.
      throw new HttpError(409, 'items_unavailable', 'Some items are no longer available', {
        unavailable_items: unavailable.map((l) => ({ cart_item_id: l.cart_item_id, name: l.name })),
      });
    }

    const { rows: orders } = await tx.query(
      `insert into public.orders
         (restaurant_id, table_id, guest_session_id, cart_id, subtotal, total_amount)
       select $1, $2, $3, $4, s.subtotal, s.subtotal
         from (select coalesce(sum(mi.price * ci.quantity), 0) as subtotal
                 from public.cart_items ci
                 join public.menu_items mi on mi.id = ci.menu_item_id
                where ci.cart_id = $4) s
       returning id`,
      [guest.restaurantId, guest.tableId, guest.sessionId, cart.id],
    );

    await tx.query(
      `insert into public.order_items
         (order_id, menu_item_id, name_at_order, price_at_order, quantity, special_instructions)
       select $1, mi.id, mi.name, mi.price, ci.quantity, ci.special_instructions
         from public.cart_items ci
         join public.menu_items mi on mi.id = ci.menu_item_id
        where ci.cart_id = $2
        order by ci.created_at, ci.id`,
      [orders[0].id, cart.id],
    );

    await tx.query(`update public.carts set status = 'converted' where id = $1`, [cart.id]);

    return { order: await readOrder(tx, orders[0].id), created: true };
  });
}

async function readOrder(q, orderId) {
  const { rows } = await q.query(
    `select o.id, o.order_number, o.status, o.subtotal, o.tax_amount, o.total_amount, o.placed_at,
            t.label as table_label
       from public.orders o join public.restaurant_tables t on t.id = o.table_id
      where o.id = $1`,
    [orderId],
  );
  const { rows: items } = await q.query(
    `select name_at_order as name, price_at_order as price, quantity, special_instructions, line_total
       from public.order_items where order_id = $1 order by name_at_order, id`,
    [orderId],
  );
  return { ...rows[0], items };
}
