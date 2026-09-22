import { Router } from 'express';
import { GUEST_SESSION_HEADER } from '../middleware/guestSession.js';
import { openMenu } from '../services/menu.js';
import * as cart from '../services/cart.js';
import { placeOrder } from '../services/orders.js';
import { getBill } from '../services/bill.js';
// publishBoardCard lives with the staff order queries, but a placed order is
// the one event the customer side ever needs to push to a staff dashboard.
import { publishBoardCard } from '../services/staffOrders.js';
import { parse, addCartItemBody, updateCartItemBody, placeOrderBody, cartItemParams } from '../validate.js';

// Customer-facing routes. No login: the table's QR token starts a guest
// session, and cart/order routes require it (X-Guest-Session header).
export function publicRoutes({ db, config, requireGuestSession, hub }) {
  const router = Router();

  // Resolve table from QR token, create a guest session (or reuse the one the
  // client sends if it is still live and for this table), return the menu.
  router.get('/menu/:qrToken', async (req, res) => {
    const menu = await openMenu(db, {
      qrToken: req.params.qrToken,
      sessionHeader: req.get(GUEST_SESSION_HEADER),
      sessionTtlHours: config.guestSessionTtlHours,
    });
    res.json(menu);
  });

  // Server-side cart, one open cart per guest session.
  router.get('/cart', requireGuestSession, async (req, res) => {
    res.json(await cart.getCart(db, req.guest));
  });

  router.post('/cart/items', requireGuestSession, async (req, res) => {
    const body = parse(addCartItemBody, req.body);
    res.status(201).json(await cart.addItem(db, req.guest, body));
  });

  router.patch('/cart/items/:cartItemId', requireGuestSession, async (req, res) => {
    const { cartItemId } = parse(cartItemParams, req.params);
    const body = parse(updateCartItemBody, req.body);
    res.json(await cart.updateItem(db, req.guest, cartItemId, body));
  });

  router.delete('/cart/items/:cartItemId', requireGuestSession, async (req, res) => {
    const { cartItemId } = parse(cartItemParams, req.params);
    res.json(await cart.removeItem(db, req.guest, cartItemId));
  });

  // Convert the open cart into an order, in one transaction. A retried or
  // double-tapped request finds the cart already converted and gets the same
  // order back (200) instead of a duplicate (the first request gets 201).
  router.post('/orders', requireGuestSession, async (req, res) => {
    const body = parse(placeOrderBody, req.body);
    const { order, created } = await placeOrder(db, req.guest, body);
    res.status(created ? 201 : 200).json({ order });
    // Only on a genuine creation — a retry/double-tap resolving to the SAME
    // already-existing order must never make it flash onto the board twice.
    if (created) publishBoardCard(hub, db, req.guest.restaurantId, order.id, 'order_created');
  });

  // Read-only summary of this guest session's orders, to show at the counter.
  router.get('/bill', requireGuestSession, async (req, res) => {
    res.json(await getBill(db, req.guest));
  });

  return router;
}
