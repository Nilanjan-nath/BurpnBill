import express, { Router } from 'express';
import { requireOwner, requireFrontOfHouse } from '../middleware/auth.js';
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
import { getDashboardSummary } from '../services/dashboard.js';
import {
  listMenuItemsAdmin,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  setItemAvailability,
  setItemImage,
} from '../services/menuAdmin.js';
import {
  listMenuCategories,
  createMenuCategory,
  updateMenuCategory,
  deleteMenuCategory,
} from '../services/menuCategories.js';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '../services/itemImages.js';
import { listTables, createTable, updateTable, deleteTable, getTableBill, checkoutTable } from '../services/tables.js';
import { getRestaurantProfile, updateRestaurantProfile, updateOwnProfile } from '../services/restaurantProfile.js';
import { listStaff, inviteStaff, revokeInvite, updateStaffRole, removeStaff } from '../services/staffAdmin.js';
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
  categoryIdParams,
  createMenuCategoryBody,
  updateMenuCategoryBody,
  createTableBody,
  updateTableBody,
  updateRestaurantBody,
  updateOwnProfileBody,
  checkoutTableBody,
  createStaffOrderBody,
  tableIdParams,
  inviteStaffBody,
  updateStaffRoleBody,
  staffUserParams,
  inviteIdParams,
  dashboardQuery,
} from '../validate.js';

// Staff/owner routes. Every one requires a signed-in staff member, and every
// query is scoped to req.staff.restaurantId.
//   owner: everything
//   staff: work the order board, 86 items
export function staffRoutes({ db, requireStaff, hub, imageStore }) {
  const router = Router();
  const staff = [requireStaff];
  const owner = [requireStaff, requireOwner];
  // POS, the floor and settling a table: owner or front-of-house staff, not
  // the kitchen. See middleware/auth.js for why this isn't owner-only.
  const till = [requireStaff, requireFrontOfHouse];

  // Who am I, and which cafe — the dashboard calls this after sign-in.
  router.get('/me', staff, (req, res) => {
    res.json({ staff: req.staff });
  });
  // Your own display name. Never a role — that is the owner's Staff tab, and
  // accepting one here would let the kitchen promote itself.
  router.patch('/me', staff, async (req, res) => {
    const body = parse(updateOwnProfileBody, req.body);
    const updated = await updateOwnProfile(db, req.staff.userId, body);
    if (!updated) throw notFound('Staff member not found');
    res.json({ staff: { ...req.staff, displayName: updated.display_name } });
  });

  // The café's own profile (Settings → Restaurant Profile). Any staff member
  // can read it — the currency alone decides how every price on their screen
  // is formatted — but only the owner changes it.
  router.get('/restaurant', staff, async (req, res) => {
    const restaurant = await getRestaurantProfile(db, req.staff.restaurantId);
    if (!restaurant) throw notFound('Restaurant not found');
    res.json({ restaurant });
  });
  router.patch('/restaurant', owner, async (req, res) => {
    const body = parse(updateRestaurantBody, req.body);
    const restaurant = await updateRestaurantProfile(db, req.staff.restaurantId, body);
    if (!restaurant) throw notFound('Restaurant not found');
    res.json({ restaurant });
  });

  // Live order board (step 4).
  router.get('/orders', staff, async (req, res) => {
    const { status, table_id } = parse(listOrdersQuery, req.query);
    res.json(await listActiveOrders(db, req.staff.restaurantId, { status, tableId: table_id }));
  });
  // Registered before /orders/:orderId — otherwise "recent" would be read as an order id.
  router.get('/orders/recent', staff, async (req, res) => {
    const { hours, day, tz } = parse(recentOrdersQuery, req.query);
    res.json(await getRecentOrders(db, req.staff.restaurantId, { hours, day, timeZone: tz }));
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
    // Nothing will ever render this photo again, and the soft-deleted row was
    // the only record of where it lived.
    if (deleted.image_url) await imageStore?.remove(deleted.image_url);
    res.status(204).end();
  });
  router.patch('/items/:itemId/availability', staff, async (req, res) => {
    const { itemId } = parse(itemIdParams, req.params);
    const { is_available } = parse(setAvailabilityBody, req.body);
    const item = await setItemAvailability(db, req.staff.restaurantId, itemId, is_available);
    if (!item) throw notFound('Item not found');
    res.json({ item });
  });

  // The item photo. Raw bytes with an image Content-Type rather than multipart:
  // there is exactly one file, no other fields travel with it, and this needs
  // no parser beyond what Express already ships. express.json above ignores the
  // body because the content type doesn't match it.
  router.put(
    '/items/:itemId/image',
    owner,
    express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      const { itemId } = parse(itemIdParams, req.params);
      const contentType = req.get('content-type')?.split(';')[0].trim();
      if (!IMAGE_TYPES[contentType]) {
        throw new HttpError(415, 'unsupported_image', 'Photos must be a PNG, JPG or WEBP');
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(400, 'empty_image', 'That file arrived empty');
      }

      const url = await imageStore.upload({
        restaurantId: req.staff.restaurantId,
        itemId,
        bytes: req.body,
        contentType,
      });
      const item = await setItemImage(db, req.staff.restaurantId, itemId, url);
      // The item vanished between the upload and the write — don't leave the
      // file behind pointing at nothing.
      if (!item) {
        await imageStore.remove(url);
        throw notFound('Item not found');
      }
      if (item.replaced_image_url) await imageStore.remove(item.replaced_image_url);

      const { replaced_image_url, ...rest } = item;
      res.json({ item: rest });
    },
  );

  router.delete('/items/:itemId/image', owner, async (req, res) => {
    const { itemId } = parse(itemIdParams, req.params);
    const item = await setItemImage(db, req.staff.restaurantId, itemId, null);
    if (!item) throw notFound('Item not found');
    if (item.replaced_image_url) await imageStore?.remove(item.replaced_image_url);

    const { replaced_image_url, ...rest } = item;
    res.json({ item: rest });
  });

  // Menu categories (step 6). Readable by anyone on the dashboard — the Menu
  // tab groups by them for the kitchen too — but only the owner rearranges the
  // menu.
  router.get('/categories', staff, async (req, res) => {
    res.json({ categories: await listMenuCategories(db, req.staff.restaurantId) });
  });
  router.post('/categories', owner, async (req, res) => {
    const body = parse(createMenuCategoryBody, req.body);
    res.status(201).json({ category: await createMenuCategory(db, req.staff.restaurantId, body) });
  });
  router.patch('/categories/:categoryId', owner, async (req, res) => {
    const { categoryId } = parse(categoryIdParams, req.params);
    const body = parse(updateMenuCategoryBody, req.body);
    const category = await updateMenuCategory(db, req.staff.restaurantId, categoryId, body);
    if (!category) throw notFound('Category not found');
    res.json({ category });
  });
  router.delete('/categories/:categoryId', owner, async (req, res) => {
    const { categoryId } = parse(categoryIdParams, req.params);
    const result = await deleteMenuCategory(db, req.staff.restaurantId, categoryId);
    if (!result) throw notFound('Category not found');
    // What happened to the food that was in it, so the UI can say so.
    res.json(result);
  });

  // Tables and their QR tokens (step 5).
  router.get('/tables', staff, async (req, res) => {
    res.json({ tables: await listTables(db, req.staff.restaurantId) });
  });
  router.post('/tables', owner, async (req, res) => {
    const body = parse(createTableBody, req.body);
    res.status(201).json({ table: await createTable(db, req.staff.restaurantId, body) });
  });
  // Rename, reseat, or pause a table. Pausing is what closes a table for the
  // evening without reprinting its QR code — see updateTable in tables.js.
  router.patch('/tables/:tableId', owner, async (req, res) => {
    const { tableId } = parse(tableIdParams, req.params);
    const body = parse(updateTableBody, req.body);
    const table = await updateTable(db, req.staff.restaurantId, tableId, body);
    if (!table) throw notFound('Table not found');
    res.json({ table });
  });
  // Retiring a table. Soft, because orders.table_id cascades — see
  // deleteTable in tables.js. Refused while the table still owes money.
  router.delete('/tables/:tableId', owner, async (req, res) => {
    const { tableId } = parse(tableIdParams, req.params);
    const result = await deleteTable(db, req.staff.restaurantId, tableId);
    if (result.reason === 'not_found') throw notFound('Table not found');
    if (result.reason === 'unpaid_orders') {
      throw new HttpError(409, 'unpaid_orders', 'Settle this table before removing it — it still has an unpaid bill', {
        unpaid_count: result.unpaid_count,
        unpaid_total: result.unpaid_total,
      });
    }
    res.status(204).end();
  });
  // The staff-side table bill, and settling it. The money itself is taken at
  // the counter — this records which method was used and frees the table. See
  // tables.js for why there's no gateway involved.
  router.get('/tables/:tableId/bill', till, async (req, res) => {
    const { tableId } = parse(tableIdParams, req.params);
    res.json(await getTableBill(db, req.staff.restaurantId, tableId));
  });
  router.post('/tables/:tableId/checkout', till, async (req, res) => {
    const { tableId } = parse(tableIdParams, req.params);
    const { method, idempotency_key: idempotencyKey } = parse(checkoutTableBody, req.body);
    res.json(await checkoutTable(db, req.staff.restaurantId, tableId, { method, idempotencyKey }));
  });

  // Floor map + POS (step 7). Owner only — see TASKS.md step 7's "Decided"
  // note: no cashier/waiter role yet, so there's no one else to gate this to.
  router.get('/floor', till, async (req, res) => {
    res.json(await getFloor(db, req.staff.restaurantId));
  });
  router.post('/staff/orders', till, async (req, res) => {
    const body = parse(createStaffOrderBody, req.body);
    const orderId = await placeStaffOrder(db, req.staff.restaurantId, req.staff.userId, body);
    const order = await getOrderDetail(db, req.staff.restaurantId, orderId);
    res.status(201).json({ order });
    publishBoardCard(hub, db, req.staff.restaurantId, orderId, 'order_created');
  });

  // Today at a glance (step 6 slice 4) — owner only: it reports money.
  router.get('/dashboard/summary', owner, async (req, res) => {
    const { tz } = parse(dashboardQuery, req.query);
    res.json(await getDashboardSummary(db, req.staff.restaurantId, tz));
  });

  // Staff management (step 6 slice 5) — owner only. An invite is a
  // pre-authorised email, not an account: nothing is sent, and the person is
  // linked on their first authenticated request (see middleware/auth.js).
  router.get('/staff', owner, async (req, res) => {
    res.json(await listStaff(db, req.staff.restaurantId));
  });
  router.post('/staff/invites', owner, async (req, res) => {
    const body = parse(inviteStaffBody, req.body);
    res.status(201).json({ invite: await inviteStaff(db, req.staff.restaurantId, req.staff.userId, body) });
  });
  router.delete('/staff/invites/:inviteId', owner, async (req, res) => {
    const { inviteId } = parse(inviteIdParams, req.params);
    await revokeInvite(db, req.staff.restaurantId, inviteId);
    res.status(204).end();
  });
  router.patch('/staff/:userId', owner, async (req, res) => {
    const { userId } = parse(staffUserParams, req.params);
    const { role } = parse(updateStaffRoleBody, req.body);
    res.json({ member: await updateStaffRole(db, req.staff.restaurantId, userId, role) });
  });
  router.delete('/staff/:userId', owner, async (req, res) => {
    const { userId } = parse(staffUserParams, req.params);
    await removeStaff(db, req.staff.restaurantId, userId);
    res.status(204).end();
  });

  return router;
}
