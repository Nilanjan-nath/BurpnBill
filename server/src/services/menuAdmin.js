// Owner-side menu management. Every function is scoped by restaurantId taken
// from the signed-in staff member, never from the request — the same rule as
// every other staff query in this codebase.

// GET /items — the admin list: every live item, INCLUDING 86'd ones (the
// owner needs to see and re-enable them), but never a soft-deleted one.
// Uses menu_items_admin_read_idx, the same index the schema already built
// for this exact query.
export async function listMenuItemsAdmin(db, restaurantId) {
  const { rows } = await db.query(
    `select id, name, description, category, price, is_available, is_veg, image_url, sort_order
       from public.menu_items
      where restaurant_id = $1 and deleted_at is null
      order by category, sort_order, name`,
    [restaurantId],
  );
  return rows;
}

// POST /items — owner only.
export async function createMenuItem(db, restaurantId, input) {
  const { rows } = await db.query(
    `insert into public.menu_items (restaurant_id, name, description, category, price, is_veg, sort_order)
     values ($1, $2, $3, coalesce($4, 'Uncategorised'), $5, $6, coalesce($7, 0))
     returning id, name, description, category, price, is_available, is_veg, image_url, sort_order`,
    [restaurantId, input.name, input.description ?? null, input.category ?? null, input.price, input.is_veg ?? null, input.sort_order ?? null],
  );
  return rows[0];
}

// PATCH /items/:id — owner only. Only the fields present in `input` change;
// everything else keeps its current value (coalesce against the existing
// row rather than requiring the client to resend the whole item).
export async function updateMenuItem(db, restaurantId, itemId, input) {
  const { rows } = await db.query(
    `update public.menu_items
        set name        = coalesce($3, name),
            description = case when $4::boolean then $5 else description end,
            category    = coalesce($6, category),
            price       = coalesce($7, price),
            is_veg      = case when $8::boolean then $9 else is_veg end,
            sort_order  = coalesce($10, sort_order)
      where id = $1 and restaurant_id = $2 and deleted_at is null
      returning id, name, description, category, price, is_available, is_veg, image_url, sort_order`,
    [
      itemId,
      restaurantId,
      input.name ?? null,
      'description' in input, // whether the client sent this field at all — needed to allow clearing it to null
      input.description ?? null,
      input.category ?? null,
      input.price ?? null,
      'is_veg' in input,
      input.is_veg ?? null,
      input.sort_order ?? null,
    ],
  );
  return rows[0] ?? null;
}

// DELETE /items/:id — owner only, soft delete. Past orders keep their own
// name_at_order/price_at_order snapshot (see docs/schema.md), so deleting a
// menu item never rewrites history — it just stops it being orderable.
export async function deleteMenuItem(db, restaurantId, itemId) {
  const { rows } = await db.query(
    `update public.menu_items set deleted_at = now()
      where id = $1 and restaurant_id = $2 and deleted_at is null
      returning id`,
    [itemId, restaurantId],
  );
  return rows.length > 0;
}

// PATCH /items/:id/availability — owner AND staff (the kitchen 86s an item
// mid-service; that shouldn't need the owner).
export async function setItemAvailability(db, restaurantId, itemId, isAvailable) {
  const { rows } = await db.query(
    `update public.menu_items set is_available = $3
      where id = $1 and restaurant_id = $2 and deleted_at is null
      returning id, name, description, category, price, is_available, is_veg, image_url, sort_order`,
    [itemId, restaurantId, isAvailable],
  );
  return rows[0] ?? null;
}
