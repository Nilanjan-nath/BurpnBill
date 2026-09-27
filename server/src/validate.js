import { z } from 'zod';
import { badRequest } from './errors.js';

// Loose UUID shape: the seeded restaurant id (1111…) is not a strict v4 UUID.
export const id = z.guid();

export const quantity = z.number().int().min(1, 'Quantity must be at least 1').max(99, 'Quantity can be at most 99');

// Free-text note: trimmed, blank becomes null, 280 chars max (same as the column).
// Rendered as plain text everywhere — never as HTML.
export const note = z
  .string()
  .trim()
  .max(280, 'Notes can be at most 280 characters')
  .transform((s) => (s === '' ? null : s))
  .nullable();

export const addCartItemBody = z.strictObject({
  menu_item_id: id,
  quantity,
  special_instructions: note.optional().default(null),
});

export const updateCartItemBody = z
  .strictObject({
    quantity: quantity.optional(),
    special_instructions: note.optional(),
  })
  .refine((b) => b.quantity !== undefined || b.special_instructions !== undefined, {
    message: 'Send quantity, special_instructions, or both',
  });

export const placeOrderBody = z.strictObject({ cart_id: id });

export const cartItemParams = z.strictObject({ cartItemId: id });

export const orderIdParams = z.strictObject({ orderId: id });

// GET /orders/recent. Default 4 hours (a shift); capped at a week so a typo
// like ?hours=99999 can't force a full-table scan of every order ever placed.
export const recentOrdersQuery = z.strictObject({
  hours: z.coerce.number().int().min(1).max(24 * 7).optional().default(4),
});

// PATCH /orders/:id/status. 'placed' is never a valid target — it's set once,
// automatically, when the customer's order is created.
export const updateOrderStatusBody = z.strictObject({
  status: z.enum(['preparing', 'ready', 'served', 'cancelled']),
});

// GET /orders. Only statuses that still need work: served and cancelled orders live
// under GET /orders/recent.
export const listOrdersQuery = z.strictObject({
  status: z.enum(['placed', 'preparing', 'ready']).optional(),
  table_id: id.optional(),
});

// Menu admin (step 5). description/is_veg are nullable — a client can send
// `null` on purpose to clear one, which is different from leaving it out to
// mean "don't touch this field" (see updateMenuItem in services/menuAdmin.js).
const itemName = z.string().trim().min(1, 'Name is required').max(200);
const itemDescription = z
  .string()
  .trim()
  .max(500, 'Description can be at most 500 characters')
  .transform((s) => (s === '' ? null : s))
  .nullable();
const itemCategory = z.string().trim().min(1, 'Category cannot be blank').max(60);
const itemPrice = z.number().min(0, 'Price cannot be negative').max(100_000, 'That price looks like a typo');
const itemIsVeg = z.boolean().nullable();
const itemSortOrder = z.number().int().min(0).max(100_000);

export const itemIdParams = z.strictObject({ itemId: id });

export const createMenuItemBody = z.strictObject({
  name: itemName,
  description: itemDescription.optional(),
  category: itemCategory.optional(),
  price: itemPrice,
  is_veg: itemIsVeg.optional(),
  sort_order: itemSortOrder.optional(),
});

export const updateMenuItemBody = z
  .strictObject({
    name: itemName.optional(),
    description: itemDescription.optional(),
    category: itemCategory.optional(),
    price: itemPrice.optional(),
    is_veg: itemIsVeg.optional(),
    sort_order: itemSortOrder.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to update' });

export const setAvailabilityBody = z.strictObject({ is_available: z.boolean() });

// POST /tables. `seats` is nullable — not every table needs a seat count on
// the printed QR sheet.
export const createTableBody = z.strictObject({
  label: z.string().trim().min(1, 'Label is required').max(40, 'Label can be at most 40 characters'),
  seats: z.number().int().min(1).max(100).nullable().optional(),
});

// POST /staff/orders (step 7, POS) — a staff member placing an order for a
// walk-in, dine-in only. Same item shape as the customer cart's add-item
// body; special_instructions defaults to null the same way.
export const staffOrderItem = z.strictObject({
  menu_item_id: id,
  quantity,
  special_instructions: note.optional().default(null),
});
export const createStaffOrderBody = z.strictObject({
  table_id: id,
  items: z.array(staffOrderItem).min(1, 'Add at least one item'),
});

export const tableIdParams = z.strictObject({ tableId: id });

// Staff management (step 6 slice 5). 'kitchen' is the old catch-all 'staff'
// minus POS; 'staff' is front of house.
const staffRole = z.enum(['owner', 'staff', 'kitchen']);
export const inviteStaffBody = z.strictObject({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  role: staffRole,
  display_name: z.string().trim().min(1).max(80).optional(),
});
export const updateStaffRoleBody = z.strictObject({ role: staffRole });
export const staffUserParams = z.strictObject({ userId: id });
export const inviteIdParams = z.strictObject({ inviteId: id });

// GET /dashboard/summary?tz=. An IANA zone name from the browser, so "today"
// means the cafe's day rather than UTC's (which rolls over mid-morning-shift
// in India). Shape-checked only — the service resolves it against
// pg_timezone_names and falls back to UTC, so an unknown-but-valid-looking
// name degrades instead of erroring.
export const dashboardQuery = z.strictObject({
  tz: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_-]+)*$/, 'Not a time zone name')
    .optional(),
});

// POST /tables/:tableId/checkout. `method` mirrors the schema's own
// payment_method enum minus 'mock', which exists for tests, not for a cashier
// to pick. idempotency_key is the client's — a retried Confirm must not settle
// the table twice (see checkoutTable).
export const checkoutTableBody = z.strictObject({
  method: z.enum(['cash', 'card', 'upi']),
  idempotency_key: z.string().trim().min(8).max(128),
});

// Throws a 400 listing every problem, or returns the parsed (cleaned) value.
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw badRequest(
    'Invalid request',
    { issues: result.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message })) },
  );
}
