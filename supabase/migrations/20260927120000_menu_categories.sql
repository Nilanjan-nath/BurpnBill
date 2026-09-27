-- Categories become a record of their own, instead of a string typed onto
-- every item.
--
-- The free-text `menu_items.category` could not represent two things the owner
-- actually needs: a category that exists before anything is in it ("Desserts",
-- created while the first dessert is still being written), and an order that
-- isn't the alphabet's (Appetizers, then Mains, then Beverages — not
-- Beverages, Desserts, Mains, Snacks). Both are properties of the category,
-- so the category needs somewhere to live.
--
-- `category_id` is deliberately NULLABLE, and null reads as "Uncategorised"
-- everywhere. That keeps `POST /items`'s contract exactly as step 5 set it
-- (name and price required, everything else optional) and means deleting a
-- category never needs a magic fallback row to move its items into.

create table public.menu_categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.menu_categories.display_order is
  'The owner''s own menu order. Lower comes first; ties break on name. Seeded in tens so a category can be slotted between two others without renumbering.';

-- Every other child table in this schema points at a composite key so that a
-- cross-tenant reference is impossible even with an application bug. Same here.
create unique index menu_categories_tenant_key
  on public.menu_categories (id, restaurant_id);

-- One "Beverages" per cafe. Case- and whitespace-insensitive, because "beverages"
-- typed a second time is the same category to everyone except the database.
create unique index menu_categories_name_key
  on public.menu_categories (restaurant_id, lower(btrim(name)));

create index menu_categories_order_idx
  on public.menu_categories (restaurant_id, display_order, name);

alter table public.menu_categories enable row level security;

create trigger menu_categories_set_updated_at
  before update on public.menu_categories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Point menu items at it.
-- -----------------------------------------------------------------------------

alter table public.menu_items add column category_id uuid;

-- No ON DELETE action on purpose: deleting a category moves its items to
-- Uncategorised first, in one transaction (services/menuAdmin.js). `SET NULL`
-- on a composite foreign key would null `restaurant_id` too, and the column-list
-- form that avoids that is Postgres 15+ only — not worth depending on for
-- something the delete path has to be explicit about anyway.
alter table public.menu_items
  add constraint menu_items_category_fk
  foreign key (category_id, restaurant_id)
  references public.menu_categories (id, restaurant_id);

comment on column public.menu_items.category_id is
  'Null means Uncategorised — a real state, not missing data. Reads coalesce it to that name and sort it last.';

comment on column public.menu_items.image_url is
  'Public URL of the item photo in the menu-images storage bucket. Null means no photo; the UI falls back to a monogram.';

-- Backfill: one category per distinct name already in use, ordered the way the
-- menu reads today (alphabetically) so nothing visibly reorders the moment this
-- lands. Items already sitting in "Uncategorised" stay null — that is the same
-- state, now spelled the way the rest of the schema spells it.
with used as (
  select restaurant_id,
         min(btrim(category)) as name,
         lower(btrim(category)) as key
    from public.menu_items
   where deleted_at is null
     and btrim(category) <> ''
     and lower(btrim(category)) <> 'uncategorised'
   group by restaurant_id, lower(btrim(category))
)
insert into public.menu_categories (restaurant_id, name, display_order)
select restaurant_id,
       name,
       (row_number() over (partition by restaurant_id order by name)) * 10
  from used;

update public.menu_items i
   set category_id = c.id
  from public.menu_categories c
 where c.restaurant_id = i.restaurant_id
   and lower(btrim(i.category)) = lower(btrim(c.name));

-- -----------------------------------------------------------------------------
-- Retire the text column, and rebuild the two indexes that were sorting on it.
-- -----------------------------------------------------------------------------

-- The customer menu read is still one index scan for the filter; what changed is
-- that grouping now joins a table with a handful of rows in it, and the sort key
-- is the owner's `display_order` rather than the category's spelling.
drop index public.menu_items_public_read_idx;
drop index public.menu_items_admin_read_idx;

alter table public.menu_items drop column category;

create index menu_items_public_read_idx
  on public.menu_items (restaurant_id, category_id, sort_order, name)
  where deleted_at is null and is_available;

create index menu_items_admin_read_idx
  on public.menu_items (restaurant_id, category_id, sort_order)
  where deleted_at is null;
