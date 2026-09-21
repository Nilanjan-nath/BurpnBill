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

// Throws a 400 listing every problem, or returns the parsed (cleaned) value.
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  throw badRequest(
    'Invalid request',
    { issues: result.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message })) },
  );
}
