import { Router } from 'express';
import { notImplemented } from '../errors.js';

// Customer-facing routes. No login: the table's QR token starts a guest
// session, and cart/order routes require it (X-Guest-Session header).
export function publicRoutes({ requireGuestSession }) {
  const router = Router();

  // Resolve table from QR token, create a guest session (or reuse the one the
  // client sends if it is still live and for this table), return the menu.
  router.get('/menu/:qrToken', notImplemented(3));

  // Server-side cart, one open cart per guest session.
  router.get('/cart', requireGuestSession, notImplemented(3));
  router.post('/cart/items', requireGuestSession, notImplemented(3));
  router.patch('/cart/items/:cartItemId', requireGuestSession, notImplemented(3));
  router.delete('/cart/items/:cartItemId', requireGuestSession, notImplemented(3));

  // Convert the open cart into an order, in one transaction. A retried or
  // double-tapped request finds the cart already converted and gets the same
  // order back instead of a duplicate.
  router.post('/orders', requireGuestSession, notImplemented(3));

  return router;
}
