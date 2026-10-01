import { Router } from 'express';
import { GUEST_SESSION_HEADER } from '../middleware/guestSession.js';
import { openMenu } from '../services/menu.js';
import * as cart from '../services/cart.js';
import { placeOrder } from '../services/orders.js';
import { getBill } from '../services/bill.js';
import { getPublicReceipt } from '../services/bills.js';
import { getOrderStatus } from '../services/orderStatus.js';
// publishBoardCard lives with the staff order queries, but a placed order is
// the one event the customer side ever needs to push to a staff dashboard.
import { publishBoardCard } from '../services/staffOrders.js';
import { parse, addCartItemBody, updateCartItemBody, placeOrderBody, cartItemParams } from '../validate.js';

// Customer-facing routes. No login: the table's QR token starts a guest
// session, and cart/order routes require it (X-Guest-Session header).
export function publicRoutes({ db, config, requireGuestSession, hub, limits }) {
  const router = Router();

  // Resolve table from QR token, create a guest session (or reuse the one the
  // client sends if it is still live and for this table), return the menu.
  router.get('/menu/:qrToken', limits.perIp, limits.menu, async (req, res) => {
    const menu = await openMenu(db, {
      qrToken: req.params.qrToken,
      sessionHeader: req.get(GUEST_SESSION_HEADER),
      sessionTtlHours: config.guestSessionTtlHours,
    });
    res.json(menu);
  });

  // A settled bill's public page (the receipt's QR code). Only the token
  // gates it, so it is never cached or indexed: a receipt is for whoever was
  // handed the paper.
  router.get('/receipts/:token', limits.perIp, limits.receipts, async (req, res) => {
    const receipt = await getPublicReceipt(db, req.params.token);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.json({ receipt });
  });

  // Server-side cart, one open cart per guest session.
  router.get('/cart', limits.perIp, limits.cart, requireGuestSession, async (req, res) => {
    res.json(await cart.getCart(db, req.guest));
  });

  router.post('/cart/items', limits.perIp, limits.cart, requireGuestSession, async (req, res) => {
    const body = parse(addCartItemBody, req.body);
    res.status(201).json(await cart.addItem(db, req.guest, body));
  });

  router.patch('/cart/items/:cartItemId', limits.perIp, limits.cart, requireGuestSession, async (req, res) => {
    const { cartItemId } = parse(cartItemParams, req.params);
    const body = parse(updateCartItemBody, req.body);
    res.json(await cart.updateItem(db, req.guest, cartItemId, body));
  });

  router.delete('/cart/items/:cartItemId', limits.perIp, limits.cart, requireGuestSession, async (req, res) => {
    const { cartItemId } = parse(cartItemParams, req.params);
    res.json(await cart.removeItem(db, req.guest, cartItemId));
  });

  // Convert the open cart into an order, in one transaction. A retried or
  // double-tapped request finds the cart already converted and gets the same
  // order back (200) instead of a duplicate (the first request gets 201).
  router.post('/orders', limits.perIp, limits.order, requireGuestSession, async (req, res) => {
    const body = parse(placeOrderBody, req.body);
    const { order, created } = await placeOrder(db, req.guest, body);
    res.status(created ? 201 : 200).json({ order });
    // Only on a genuine creation — a retry/double-tap resolving to the SAME
    // already-existing order must never make it flash onto the board twice.
    // Not 'order_created': the kitchen board must not show this until staff
    // accept it. Approving publishes order_created — see approveOrder.
    if (created) publishBoardCard(hub, db, req.guest.restaurantId, order.id, 'qr_order_pending');
  });

  // Where this guest session's orders are in the kitchen — polled by the phone
  // while the status is on screen. Registered as its own path, not folded into
  // /bill: the bill is fetched once to show at the counter, this is fetched
  // repeatedly and should stay as small as a few rows.
  router.get('/orders/status', limits.perIp, limits.status, requireGuestSession, async (req, res) => {
    res.json(await getOrderStatus(db, req.guest));
  });

  // Read-only summary of this guest session's orders, to show at the counter.
  router.get('/bill', limits.perIp, limits.cart, requireGuestSession, async (req, res) => {
    res.json(await getBill(db, req.guest));
  });

  return router;
}
