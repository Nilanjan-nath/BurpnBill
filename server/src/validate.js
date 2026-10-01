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

// GET /orders/recent. Two ways to ask for a window, and only one per request:
//
//   ?hours=  a rolling window ending now — default 4 (a shift), capped at a
//            week so a typo like ?hours=99999 can't force a full-table scan of
//            every order ever placed
//   ?day=    a whole CAFÉ day, which is what the Recent tab's own Today /
//            Yesterday tabs ask for. "Today" is the café's day, not the
//            database's: Postgres runs in UTC, where the day rolls over at
//            05:30 IST — mid-morning-shift — so ?tz carries the browser's IANA
//            zone, the same contract GET /dashboard/summary already uses.
//
// Sending both is a 400 rather than one silently winning: they are different
// questions ("what just happened" vs "how did today go") and a caller that
// asks both ways doesn't know which it wants.
export const recentOrdersQuery = z
  .strictObject({
    hours: z.coerce.number().int().min(1).max(24 * 7).optional(),
    day: z.enum(['today', 'yesterday']).optional(),
    tz: z.string().min(1).max(64).optional(),
  })
  .refine((q) => !(q.day !== undefined && q.hours !== undefined), {
    message: 'Ask for either ?day or ?hours, not both',
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
// An item's category is a record now, not a string. Nullable on purpose:
// null is Uncategorised, which is a real place for an item to sit.
const itemCategoryId = id.nullable();
const itemPrice = z.number().min(0, 'Price cannot be negative').max(100_000, 'That price looks like a typo');
const itemIsVeg = z.boolean().nullable();
const itemSortOrder = z.number().int().min(0).max(100_000);

export const itemIdParams = z.strictObject({ itemId: id });

export const createMenuItemBody = z.strictObject({
  name: itemName,
  description: itemDescription.optional(),
  category_id: itemCategoryId.optional(),
  price: itemPrice,
  is_veg: itemIsVeg.optional(),
  sort_order: itemSortOrder.optional(),
});

export const updateMenuItemBody = z
  .strictObject({
    name: itemName.optional(),
    description: itemDescription.optional(),
    category_id: itemCategoryId.optional(),
    price: itemPrice.optional(),
    is_veg: itemIsVeg.optional(),
    sort_order: itemSortOrder.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to update' });

export const setAvailabilityBody = z.strictObject({ is_available: z.boolean() });

// The café's own profile (Settings → Restaurant Profile). `address` and `phone`
// are nullable so the owner can clear one; `name` and currency are not — the
// database refuses a blank name, and a café always trades in something.
const profileText = (max, label) =>
  z.string().trim().max(max, `${label} can be at most ${max} characters`).transform((v) => (v === '' ? null : v)).nullable();

export const updateRestaurantBody = z
  .strictObject({
    name: z.string().trim().min(1, 'Restaurant name is required').max(120).optional(),
    address: profileText(200, 'Address').optional(),
    phone: profileText(40, 'Phone number').optional(),
    // ISO 4217: three letters, stored and compared uppercase. The column's own
    // check constraint only enforces the length, so the shape is enforced here.
    currency_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter code, like INR')
      .optional(),
    // How food reaches the customer. Only changes the wording of "Ready" on the
    // customer's phone — see orderStatus.js.
    service_mode: z.enum(['table', 'counter']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to update' });

// POST /restaurants — signing up a new café (step 7). The only body in this API
// that isn't scoped to a café the caller already belongs to.
//
// `table_count` is capped at 48 because the floor plan is 12x8 and these are
// placed six to a row: 48 is where the room stops fitting on the plan they are
// about to open. Zero is allowed — a counter-service café that hasn't decided
// on its tables yet is a real state, and tables can be added afterwards.
export const createRestaurantBody = z.strictObject({
  name: z.string().trim().min(1, 'Your café needs a name').max(120),
  currency_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter code, like INR')
    .optional()
    .default('INR'),
  table_count: z.coerce.number().int().min(0).max(48, 'The floor plan holds 48 tables').optional().default(0),
  // Your own name, for the team list and the order timeline. Optional, because
  // the invite path already has a fallback for someone who never gave one.
  display_name: z.string().trim().min(1).max(80).optional(),
});

// PATCH /me — your own display name, and nothing else. A role is deliberately
// not accepted here; that belongs to the owner's Staff tab.
export const updateOwnProfileBody = z.strictObject({
  display_name: z.string().trim().min(1, 'Display name is required').max(80, 'Display name can be at most 80 characters'),
});

// Menu categories. `display_order` is optional everywhere — createMenuCategory
// puts a new one at the end when it's left out, which is almost always where a
// new section belongs.
const categoryName = z.string().trim().min(1, 'Category name is required').max(60, 'Category name can be at most 60 characters');
const categoryDisplayOrder = z.number().int().min(0).max(100_000);

export const categoryIdParams = z.strictObject({ categoryId: id });

export const createMenuCategoryBody = z.strictObject({
  name: categoryName,
  display_order: categoryDisplayOrder.optional(),
});

export const updateMenuCategoryBody = z
  .strictObject({
    name: categoryName.optional(),
    display_order: categoryDisplayOrder.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to update' });

// Floor-plan cells, not pixels — see the table_layout migration. The grid is
// 20x20, which is a bigger room than this is for.
const gridCell = z.number().int().min(0).max(19);

// POST /tables. `seats` is nullable — not every table needs a seat count on
// the printed QR sheet.
export const createTableBody = z.strictObject({
  label: z.string().trim().min(1, 'Label is required').max(40, 'Label can be at most 40 characters'),
  seats: z.number().int().min(1).max(100).nullable().optional(),
  // Optional: leaving it out means the first free cell (services/tables.js).
  pos_x: gridCell.optional(),
  pos_y: gridCell.optional(),
});

export const updateTableBody = z
  .strictObject({
    label: z.string().trim().min(1, 'Label is required').max(40, 'Label can be at most 40 characters').optional(),
    seats: z.number().int().min(1, 'Seats must be at least 1').max(99).nullable().optional(),
    is_active: z.boolean().optional(),
    pos_x: gridCell.optional(),
    pos_y: gridCell.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to update' })
  .refine((b) => (b.pos_x === undefined) === (b.pos_y === undefined), {
    message: 'Send both pos_x and pos_y, or neither — half a position is not a place',
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
export const billIdParams = z.strictObject({ billId: id });

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
  // Cash only: what the customer handed over, so the bill can print the change.
  amount_tendered: z.number().finite().nonnegative().max(10_000_000).optional(),
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
