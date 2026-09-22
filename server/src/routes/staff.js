import { Router } from 'express';
import { notImplemented } from '../errors.js';
import { requireOwner } from '../middleware/auth.js';
import { listActiveOrders, getRecentOrders, getOrderDetail, updateOrderStatus } from '../services/staffOrders.js';
import { notFound } from '../errors.js';
import { parse, listOrdersQuery, recentOrdersQuery, orderIdParams, updateOrderStatusBody } from '../validate.js';

// Staff/owner routes. Every one requires a signed-in staff member, and every
// query is scoped to req.staff.restaurantId.
//   owner: everything
//   staff: work the order board, 86 items
export function staffRoutes({ db, requireStaff }) {
  const router = Router();
  const staff = [requireStaff];
  const owner = [requireStaff, requireOwner];

  // Who am I, and which cafe — the dashboard calls this after sign-in.
  router.get('/me', staff, (req, res) => {
    res.json({ staff: req.staff });
  });

  // Live order board (step 4).
  router.get('/orders', staff, async (req, res) => {
    const { status, table_id } = parse(listOrdersQuery, req.query);
    res.json(await listActiveOrders(db, req.staff.restaurantId, { status, tableId: table_id }));
  });
  // Registered before /orders/:orderId — otherwise "recent" would be read as an order id.
  router.get('/orders/recent', staff, async (req, res) => {
    const { hours } = parse(recentOrdersQuery, req.query);
    res.json(await getRecentOrders(db, req.staff.restaurantId, { hours }));
  });
  router.get('/orders/:orderId', staff, async (req, res) => {
    const { orderId } = parse(orderIdParams, req.params);
    const order = await getOrderDetail(db, req.staff.restaurantId, orderId);
    if (!order) throw notFound('Order not found');
    res.json({ order });
  });
  router.patch('/orders/:orderId/status', staff, async (req, res) => {
    const { orderId } = parse(orderIdParams, req.params);
    const { status } = parse(updateOrderStatusBody, req.body);
    const order = await updateOrderStatus(db, req.staff.restaurantId, orderId, status, req.staff.userId);
    if (!order) throw notFound('Order not found');
    res.json({ order });
  });
  router.get('/restaurants/:restaurantId/orders/stream', staff, notImplemented(4)); // SSE

  // Menu management (step 5). Availability is open to all staff so the
  // kitchen can 86 an item mid-service.
  router.get('/items', staff, notImplemented(5)); // includes 86'd items
  router.post('/items', owner, notImplemented(5));
  router.patch('/items/:itemId', owner, notImplemented(5));
  router.delete('/items/:itemId', owner, notImplemented(5)); // soft delete
  router.patch('/items/:itemId/availability', staff, notImplemented(5));

  // Tables and their QR tokens (step 5).
  router.get('/tables', staff, notImplemented(5));
  router.post('/tables', owner, notImplemented(5));

  return router;
}
