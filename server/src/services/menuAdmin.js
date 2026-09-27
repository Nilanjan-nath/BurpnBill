// Owner-side menu management. Every function is scoped by restaurantId taken
// from the signed-in staff member, never from the request — the same rule as
// every other staff query in this codebase.

// One shape for every item this module returns, so the client never has to
// care which call produced a row. `category` is the resolved name and
// `category_id` the record — null in both means Uncategorised, which is a
// state rather than missing data (see the menu_categories migration).
const ITEM_COLUMNS = `i.id, i.name, i.description, i.category_id,
            coalesce(c.name, 'Uncategorised') as category,
            i.price, i.is_available, i.is_veg, i.image_url, i.sort_order`;

// Uncategorised sorts after every category the owner has deliberately placed.
const CATEGORY_ORDER = `coalesce(c.display_order, 2147483647), coalesce(c.name, 'Uncategorised')`;

// GET /items — the admin list: every live item, INCLUDING 86'd ones (the
// owner needs to see and re-enable them), but never a soft-deleted one.
// Uses menu_items_admin_read_idx for the filter; the sort then runs over a
// join to menu_categories, which holds a handful of rows per cafe.
export async function listMenuItemsAdmin(db, restaurantId) {
  const { rows } = await db.query(
    `select ${ITEM_COLUMNS}
       from public.menu_items i
       left join public.menu_categories c on c.id = i.category_id
      where i.restaurant_id = $1 and i.deleted_at is null
      order by ${CATEGORY_ORDER}, i.sort_order, i.name`,
    [restaurantId],
  );
  return rows;
}

// POST /items — owner only. A category_id from another cafe is refused by the
// composite foreign key, not by a check here (errors.js maps 23503 to a 400).
export async function createMenuItem(db, restaurantId, input) {
  const { rows } = await db.query(
    `with created as (
       insert into public.menu_items (restaurant_id, name, description, category_id, price, is_veg, sort_order)
       values ($1, $2, $3, $4, $5, $6, coalesce($7, 0))
       returning *
     )
     select ${ITEM_COLUMNS}
       from created i
       left join public.menu_categories c on c.id = i.category_id`,
    [restaurantId, input.name, input.description ?? null, input.category_id ?? null, input.price, input.is_veg ?? null, input.sort_order ?? null],
  );
  return rows[0];
}

// PATCH /items/:id — owner only, partial update: only the fields present in
// `input` change. `description`, `is_veg` and `category_id` are all clearable,
// so each carries a separate "was this field sent at all" flag — sending null
// to clear one is deliberately different from omitting it.
export async function updateMenuItem(db, restaurantId, itemId, input) {
  const { rows } = await db.query(
    `with updated as (
       update public.menu_items
          set name        = coalesce($3, name),
              description = case when $4::boolean then $5 else description end,
              category_id = case when $6::boolean then $7::uuid else category_id end,
              price       = coalesce($8, price),
              is_veg      = case when $9::boolean then $10 else is_veg end,
              sort_order  = coalesce($11, sort_order)
        where id = $1 and restaurant_id = $2 and deleted_at is null
        returning *
     )
     select ${ITEM_COLUMNS}
       from updated i
       left join public.menu_categories c on c.id = i.category_id`,
    [
      itemId,
      restaurantId,
      input.name ?? null,
      'description' in input, // whether the client sent this field at all — needed to allow clearing it to null
      input.description ?? null,
      'category_id' in input,
      input.category_id ?? null,
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
//
// Returns the item's image_url so the route can drop the orphaned file from
// storage: nothing will ever render it again, and a soft-deleted row is the
// only place its path was recorded.
export async function deleteMenuItem(db, restaurantId, itemId) {
  const { rows } = await db.query(
    `update public.menu_items set deleted_at = now()
      where id = $1 and restaurant_id = $2 and deleted_at is null
      returning id, image_url`,
    [itemId, restaurantId],
  );
  return rows[0] ?? null;
}

// PATCH /items/:id/availability — owner AND staff (the kitchen 86s an item
// mid-service; that shouldn't need the owner).
export async function setItemAvailability(db, restaurantId, itemId, isAvailable) {
  const { rows } = await db.query(
    `with toggled as (
       update public.menu_items set is_available = $3
        where id = $1 and restaurant_id = $2 and deleted_at is null
        returning *
     )
     select ${ITEM_COLUMNS}
       from toggled i
       left join public.menu_categories c on c.id = i.category_id`,
    [itemId, restaurantId, isAvailable],
  );
  return rows[0] ?? null;
}

// PUT /items/:id/image — owner only. The upload itself happens in the route
// (Supabase Storage); this records where it landed and hands back the URL it
// replaced, so the route can delete the file nothing points at any more.
export async function setItemImage(db, restaurantId, itemId, imageUrl) {
  const { rows } = await db.query(
    `with previous as (
       select image_url from public.menu_items
        where id = $1 and restaurant_id = $2 and deleted_at is null
     ),
     updated as (
       update public.menu_items set image_url = $3
        where id = $1 and restaurant_id = $2 and deleted_at is null
        returning *
     )
     select ${ITEM_COLUMNS}, (select image_url from previous) as replaced_image_url
       from updated i
       left join public.menu_categories c on c.id = i.category_id`,
    [itemId, restaurantId, imageUrl],
  );
  return rows[0] ?? null;
}
