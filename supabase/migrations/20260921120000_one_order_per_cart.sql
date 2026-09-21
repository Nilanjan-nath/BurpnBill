-- =============================================================================
-- One order per cart
--
-- POST /orders converts a cart into an order. The API locks the cart row so a
-- double-tapped or retried request gets the existing order back; this index is
-- the backstop that makes a second order from the same cart impossible even if
-- application code gets it wrong.
-- =============================================================================

create unique index orders_one_per_cart_idx
  on public.orders (cart_id)
  where cart_id is not null;
