// Menu categories — the owner's own sections, and the order they read in.
//
// Scoped by restaurantId from the signed-in staff member, never from the
// request, like every other staff query here. A duplicate name is caught by
// menu_categories_name_key and surfaces as a 409 through errors.js, so there
// is no read-then-write race to lose.

// `item_count` counts live items only. A category holding nothing but deleted
// items should read as empty, because that is what the owner sees on the menu.
const CATEGORY_COLUMNS = `c.id, c.name, c.display_order,
            (select count(*) from public.menu_items i
              where i.category_id = c.id and i.deleted_at is null)::int as item_count`;

// GET /categories — owner and staff. Staff can't edit these, but the Menu tab
// groups by them for everyone, and the kitchen reads that same grouping.
export async function listMenuCategories(db, restaurantId) {
  const { rows } = await db.query(
    `select ${CATEGORY_COLUMNS}
       from public.menu_categories c
      where c.restaurant_id = $1
      order by c.display_order, c.name`,
    [restaurantId],
  );
  return rows;
}

// POST /categories — owner only. An omitted display_order puts the category at
// the end rather than at 0: a new section almost never belongs first, and
// landing on top of an existing one would silently reorder the menu.
export async function createMenuCategory(db, restaurantId, input) {
  const { rows } = await db.query(
    `with created as (
       insert into public.menu_categories (restaurant_id, name, display_order)
       values ($1, $2, coalesce($3, (select coalesce(max(display_order), 0) + 10
                                       from public.menu_categories where restaurant_id = $1)))
       returning *
     )
     select ${CATEGORY_COLUMNS} from created c`,
    [restaurantId, input.name, input.display_order ?? null],
  );
  return rows[0];
}

// PATCH /categories/:id — owner only, partial: rename, reorder, or both.
// Renaming does not touch the items — they point at the record, which is the
// whole reason this stopped being a string.
export async function updateMenuCategory(db, restaurantId, categoryId, input) {
  const { rows } = await db.query(
    `with updated as (
       update public.menu_categories
          set name          = coalesce($3, name),
              display_order = coalesce($4, display_order)
        where id = $1 and restaurant_id = $2
        returning *
     )
     select ${CATEGORY_COLUMNS} from updated c`,
    [categoryId, restaurantId, input.name ?? null, input.display_order ?? null],
  );
  return rows[0] ?? null;
}

// DELETE /categories/:id — owner only. Deleting a section must never delete
// the food in it, so its items move to Uncategorised (category_id = null) in
// the same transaction as the delete. That is also why the foreign key has no
// ON DELETE action: the move is deliberate, not a side effect.
//
// Returns how many items were moved, so the UI can say so rather than leaving
// the owner to wonder where they went.
export async function deleteMenuCategory(db, restaurantId, categoryId) {
  return db.withTransaction(async (tx) => {
    const { rows: found } = await tx.query(
      'select id from public.menu_categories where id = $1 and restaurant_id = $2 for update',
      [categoryId, restaurantId],
    );
    if (!found[0]) return null;

    // One statement for every item pointing here, soft-deleted ones included —
    // the foreign key doesn't care that they're invisible, and they have to let
    // go before the category can be deleted. The count the owner is told about
    // is the live ones, derived from the same rows rather than counted again.
    const { rows: released } = await tx.query(
      `update public.menu_items set category_id = null
        where category_id = $1 and restaurant_id = $2
        returning deleted_at`,
      [categoryId, restaurantId],
    );
    await tx.query('delete from public.menu_categories where id = $1 and restaurant_id = $2', [categoryId, restaurantId]);

    return { moved_items: released.filter((r) => r.deleted_at === null).length };
  });
}
