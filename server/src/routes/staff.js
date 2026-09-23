import { Router } from 'express';
import { requireOwner } from '../middleware/auth.js';
import {
  listActiveOrders,
  getRecentOrders,
  getOrderDetail,
  updateOrderStatus,
  publishBoardCard,
} from '../services/staffOrders.js';
import {
  listMenuItemsAdmin,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  setItemAvailability,
} from '../services/menuAdmin.js';
import { listTables, createTable } from '../services/tables.js';
import { notFound } from '../errors.js';
import {
  parse,
  listOrdersQuery,
  recentOrdersQuery,
  orderIdParams,
  updateOrderStatusBody,
  itemIdParams,
  createMenuItemBody,
  updateMenuItemBody,
  setAvailabilityBody,
  createTableBody,
} from '../validate.js';

// Staff/owner routes. Every one requires a signed-in staff member, and every
// query is scoped to req.staff.restaurantId.
//   owner: everything
//   staff: work the order board, 86 items
export function staffRoutes({ db, requireStaff, hub }) {
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
  // Registered before /orders/:orderId, same reason as /orders/recent above
  // — otherwise "stream" would be read as an order id.
  //
  // Not read with the browser's EventSource: it can't send an Authorization
  // header, and this route needs the same staff token as everything else
  // here. The dashboard instead opens it with fetch() and reads the body as
  // it streams — see docs/TASKS.md slice 2 for why.
  router.get('/orders/stream', staff, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // ask any reverse proxy in front of this not to buffer the stream
    });
    res.write(': connected\n\n'); // an immediate frame, so the client can tell the stream is actually open
    hub.subscribe(req.staff.restaurantId, res);
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
    publishBoardCard(hub, db, req.staff.restaurantId, orderId, 'order_status_changed'); // after the response — never blocks it
  });

  // Menu management (step 5). Availability is open to all staff so the
  // kitchen can 86 an item mid-service; create/edit/delete are owner only.
  router.get('/items', staff, async (req, res) => {
    res.json({ items: await listMenuItemsAdmin(db, req.staff.restaurantId) });
  });
  router.post('/items', owner, async (req, res) => {
    const body = parse(createMenuItemBody, req.body);
    res.status(201).json({ item: await createMenuItem(db, req.staff.restaurantId, body) });
  });
  router.patch('/items/:itemId', owner, async (req, res) => {
    const { itemId } = parse(itemIdParams, req.params);
    const body = parse(updateMenuItemBody, req.body);
    const item = await updateMenuItem(db, req.staff.restaurantId, itemId, body);
    if (!item) throw notFound('Item not found');
    res.json({ item });
  });
  router.delete('/items/:itemId', owner, async (req, res) => {
    const { itemId } = parse(itemIdParams, req.params);
    const deleted = await deleteMenuItem(db, req.staff.restaurantId, itemId);
    if (!deleted) throw notFound('Item not found');
    res.status(204).end();
  });
  router.patch('/items/:itemId/availability', staff, async (req, res) => {
    const { itemId } = parse(itemIdParams, req.params);
    const { is_available } = parse(setAvailabilityBody, req.body);
    const item = await setItemAvailability(db, req.staff.restaurantId, itemId, is_available);
    if (!item) throw notFound('Item not found');
    res.json({ item });
  });

  // Tables and their QR tokens (step 5).
  router.get('/tables', staff, async (req, res) => {
    res.json({ tables: await listTables(db, req.staff.restaurantId) });
  });
  router.post('/tables', owner, async (req, res) => {
    const body = parse(createTableBody, req.body);
    res.status(201).json({ table: await createTable(db, req.staff.restaurantId, body) });
  });

  return router;
}
