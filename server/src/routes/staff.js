import { Router } from 'express';
import { requireOwner } from '../middleware/auth.js';
import {
  listActiveOrders,
  getRecentOrders,
  getOrderDetail,
  updateOrderStatus,
  placeStaffOrder,
  publishBoardCard,
  listPendingOrders,
  approveOrder,
  isPendingApproval,
} from '../services/staffOrders.js';
import { getFloor } from '../services/floor.js';
import {
  listMenuItemsAdmin,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  setItemAvailability,
} from '../services/menuAdmin.js';
import { listTables, createTable, getTableBill, checkoutTable } from '../services/tables.js';
import { notFound, HttpError } from '../errors.js';
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
  checkoutTableBody,
  createStaffOrderBody,
  tableIdParams,
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
  // QR order approval (step 6). Registered before /orders/:orderId, same reason
  // as /recent and /stream — otherwise "pending" reads as an order id.
  //
  // staff AND owner on purpose: POS is owner-only today, but an order stuck
  // waiting because the owner isn't at the till would be worse than the
  // straight-to-kitchen behaviour this replaces. See TASKS.md.
  router.get('/orders/pending', staff, async (req, res) => {
    res.json(await listPendingOrders(db, req.staff.restaurantId));
  });
  router.post('/orders/:orderId/approve', staff, async (req, res) => {
    const { orderId } = parse(orderIdParams, req.params);
    const result = await approveOrder(db, req.staff.restaurantId, orderId, req.staff.userId);
    if (result.outcome === 'not_found') throw notFound('Order not found');
    if (result.outcome === 'already_approved') {
      throw new HttpError(409, 'already_approved', 'That order was already sent to the kitchen — refresh to see the queue.');
    }
    if (result.outcome === 'not_pending') {
      throw new HttpError(409, 'not_pending', `That order is already "${result.currentStatus}" — refresh to see the queue.`);
    }
    const order = await getOrderDetail(db, req.staff.restaurantId, orderId);
    res.json({ order });
    // Only now does the kitchen hear about it.
    publishBoardCard(hub, db, req.staff.restaurantId, orderId, 'order_created');
  });
  // Turning an order away is a cancel, recorded like any other so Recent and the
  // timeline show who did it. Guarded to orders still in the queue: cancelling
  // something the kitchen has already started goes through the board's Cancel.
  router.post('/orders/:orderId/reject', staff, async (req, res) => {
    const { orderId } = parse(orderIdParams, req.params);
    if (!(await isPendingApproval(db, req.staff.restaurantId, orderId))) {
      throw notFound('Order not found');
    }
    const order = await updateOrderStatus(db, req.staff.restaurantId, orderId, 'cancelled', req.staff.userId);
    if (!order) throw notFound('Order not found');
    res.json({ order });
    publishBoardCard(hub, db, req.staff.restaurantId, orderId, 'qr_order_pending');
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
  // The staff-side table bill, and settling it. The money itself is taken at
  // the counter — this records which method was used and frees the table. See
  // tables.js for why there's no gateway involved.
  router.get('/tables/:tableId/bill', owner, async (req, res) => {
    const { tableId } = parse(tableIdParams, req.params);
    res.json(await getTableBill(db, req.staff.restaurantId, tableId));
  });
  router.post('/tables/:tableId/checkout', owner, async (req, res) => {
    const { tableId } = parse(tableIdParams, req.params);
    const { method, idempotency_key: idempotencyKey } = parse(checkoutTableBody, req.body);
    res.json(await checkoutTable(db, req.staff.restaurantId, tableId, { method, idempotencyKey }));
  });

  // Floor map + POS (step 7). Owner only — see TASKS.md step 7's "Decided"
  // note: no cashier/waiter role yet, so there's no one else to gate this to.
  router.get('/floor', owner, async (req, res) => {
    res.json(await getFloor(db, req.staff.restaurantId));
  });
  router.post('/staff/orders', owner, async (req, res) => {
    const body = parse(createStaffOrderBody, req.body);
    const orderId = await placeStaffOrder(db, req.staff.restaurantId, req.staff.userId, body);
    const order = await getOrderDetail(db, req.staff.restaurantId, orderId);
    res.status(201).json({ order });
    publishBoardCard(hub, db, req.staff.restaurantId, orderId, 'order_created');
  });

  return router;
}
