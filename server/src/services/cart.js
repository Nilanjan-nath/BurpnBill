import { HttpError, badRequest, notFound } from '../errors.js';

// The cart belongs to a guest session. At most one cart per session is 'open'
// (unique partial index); it is created on the first add. Every mutation locks
// the cart row (`for update`), so two taps at once queue up instead of racing.
//
// Prices are never accepted from the client: lines show the item's current
// price, and the price that counts is copied at checkout (services/orders.js).

const MAX_QUANTITY = 99;

export async function getCart(db, guest) {
  const { rows } = await db.query(
    `select id from public.carts where guest_session_id = $1 and status = 'open'`,
    [guest.sessionId],
  );
  return readCart(db, rows[0]?.id ?? null);
}

export function addItem(db, guest, { menu_item_id, quantity, special_instructions }) {
  return db.withTransaction(async (tx) => {
    const cartId = await lockOrCreateOpenCart(tx, guest);

    // The item must belong to this session's restaurant. cart_items carries no
    // restaurant_id, so this check is the only thing stopping a forged item id
    // from another cafe.
    const { rows } = await tx.query(
      `select is_available and deleted_at is null as orderable
         from public.menu_items where id = $1 and restaurant_id = $2`,
      [menu_item_id, guest.restaurantId],
    );
    if (!rows[0]) throw notFound('That item is not on this menu');
    if (!rows[0].orderable) {
      throw new HttpError(409, 'item_unavailable', 'Sorry, that item is not available right now');
    }

    // Same item + same notes = same line; different notes = a separate line.
    const { rows: existing } = await tx.query(
      `select id, quantity from public.cart_items
        where cart_id = $1 and menu_item_id = $2 and special_instructions is not distinct from $3`,
      [cartId, menu_item_id, special_instructions],
    );

    if (existing[0]) {
      const total = existing[0].quantity + quantity;
      if (total > MAX_QUANTITY) throw badRequest(`You can order at most ${MAX_QUANTITY} of one item`);
      await tx.query('update public.cart_items set quantity = $1 where id = $2', [total, existing[0].id]);
    } else {
      await tx.query(
        `insert into public.cart_items (cart_id, menu_item_id, quantity, special_instructions)
         values ($1, $2, $3, $4)`,
        [cartId, menu_item_id, quantity, special_instructions],
      );
    }

    return readCart(tx, cartId);
  });
}

export function updateItem(db, guest, cartItemId, { quantity, special_instructions }) {
  return db.withTransaction(async (tx) => {
    const cartId = await lockOpenCart(tx, guest);
    const { rowCount } = await tx.query(
      `update public.cart_items
          set quantity = coalesce($3::int, quantity),
              special_instructions = case when $4::boolean then $5::text else special_instructions end
        where id = $1 and cart_id = $2`,
      [cartItemId, cartId, quantity ?? null, special_instructions !== undefined, special_instructions ?? null],
    );
    if (!rowCount) throw notFound('That item is not in your cart');
    return readCart(tx, cartId);
  });
}

export function removeItem(db, guest, cartItemId) {
  return db.withTransaction(async (tx) => {
    const cartId = await lockOpenCart(tx, guest);
    const { rowCount } = await tx.query('delete from public.cart_items where id = $1 and cart_id = $2', [
      cartItemId,
      cartId,
    ]);
    if (!rowCount) throw notFound('That item is not in your cart');
    return readCart(tx, cartId);
  });
}

// --- helpers ---------------------------------------------------------------

async function lockOpenCart(tx, guest) {
  const { rows } = await tx.query(
    `select id from public.carts where guest_session_id = $1 and status = 'open' for update`,
    [guest.sessionId],
  );
  if (!rows[0]) throw notFound('Your cart is empty');
  return rows[0].id;
}

async function lockOrCreateOpenCart(tx, guest) {
  // No-op if this session already has an open cart (the unique partial index
  // decides), so two first-adds at once can't create two carts.
  await tx.query(
    `insert into public.carts (restaurant_id, table_id, guest_session_id)
     values ($1, $2, $3)
     on conflict (guest_session_id) where status = 'open' do nothing`,
    [guest.restaurantId, guest.tableId, guest.sessionId],
  );
  return lockOpenCart(tx, guest);
}

// The cart as the customer sees it: current names and prices, a server-side
// subtotal, and `available` per line so the app can flag anything 86'd since
// it was added. Checkout re-checks; this is only for display.
async function readCart(q, cartId) {
  if (!cartId) return { cart_id: null, items: [], subtotal: '0.00', has_unavailable_items: false };

  const { rows } = await q.query(
    `select ci.id, ci.menu_item_id, mi.name, mi.price, ci.quantity, ci.special_instructions,
            (mi.price * ci.quantity) as line_total,
            (mi.is_available and mi.deleted_at is null) as available
       from public.cart_items ci
       join public.menu_items mi on mi.id = ci.menu_item_id
      where ci.cart_id = $1
      order by ci.created_at, ci.id`,
    [cartId],
  );
  const { rows: sum } = await q.query(
    `select coalesce(sum(mi.price * ci.quantity), 0)::numeric(12, 2) as subtotal
       from public.cart_items ci join public.menu_items mi on mi.id = ci.menu_item_id
      where ci.cart_id = $1`,
    [cartId],
  );

  return {
    cart_id: cartId,
    items: rows,
    subtotal: sum[0].subtotal,
    has_unavailable_items: rows.some((r) => !r.available),
  };
}
