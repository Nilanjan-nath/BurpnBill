-- The floor plan: where each table actually sits in the room, and a way to
-- retire one.
--
-- Positions are GRID CELLS, not pixels. A pixel offset means something
-- different on a phone, a till screen and a printed sheet; a cell is the same
-- square everywhere, so the room reads the same on all of them. Both columns
-- are nullable — a table that has not been placed yet is a real state, and the
-- UI flows those into the first free cells rather than pretending they are at
-- the origin.

alter table public.restaurant_tables
  add column pos_x smallint check (pos_x is null or pos_x between 0 and 199),
  add column pos_y smallint check (pos_y is null or pos_y between 0 and 199);

comment on column public.restaurant_tables.pos_x is
  'Column on the floor-plan grid, 0-based. Null means not placed yet. Grid cells, never pixels — a cell is the same square on every screen.';

-- -----------------------------------------------------------------------------
-- Retiring a table.
-- -----------------------------------------------------------------------------
--
-- A SOFT delete, and it has to be: orders.table_id references this table
-- ON DELETE CASCADE, so removing a row would take every order ever placed at
-- it — with its items, payments and timeline — out of the history the
-- dashboard reports on. Same reasoning as menu_items.deleted_at, and the same
-- shape, so there is one way to retire a thing in this schema rather than two.

alter table public.restaurant_tables add column deleted_at timestamptz;

comment on column public.restaurant_tables.deleted_at is
  'Soft delete. A deleted table stops appearing anywhere and its QR code stops resolving, but its orders keep their history — the FK from orders is ON DELETE CASCADE, so an actual DELETE would erase them.';

-- The label must be unique among LIVE tables only. A retired "Table 4" should
-- not stop the owner naming the new one in its place "Table 4" — the old row
-- exists for history, not to hold a name hostage.
alter table public.restaurant_tables drop constraint restaurant_tables_label_unique;

create unique index restaurant_tables_label_live_unique
  on public.restaurant_tables (restaurant_id, label)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- One table per cell.
-- -----------------------------------------------------------------------------
--
-- Two tables stacked on the same square is a drawing of a room that does not
-- exist, so the database refuses it rather than the UI merely discouraging it.
-- That makes dropping a table onto an occupied cell a 409 the screen can act
-- on, instead of a silent overlap nobody notices until they print the plan.
create unique index restaurant_tables_cell_unique
  on public.restaurant_tables (restaurant_id, pos_x, pos_y)
  where deleted_at is null and pos_x is not null and pos_y is not null;

-- -----------------------------------------------------------------------------
-- Place the tables that already exist.
-- -----------------------------------------------------------------------------
--
-- Row-major in creation order, six to a row — the order they were already
-- listed in, so the first time the owner opens the floor plan it matches the
-- list they have been looking at, and they are arranging rather than
-- untangling.
with placed as (
  select id,
         (row_number() over (partition by restaurant_id order by created_at) - 1) as seq
    from public.restaurant_tables
   where deleted_at is null
)
update public.restaurant_tables t
   set pos_x = (placed.seq % 6),
       pos_y = (placed.seq / 6)
  from placed
 where placed.id = t.id;

-- The floor plan and the seating plan both read every live table in layout
-- order.
create index restaurant_tables_layout_idx
  on public.restaurant_tables (restaurant_id, pos_y, pos_x)
  where deleted_at is null;
