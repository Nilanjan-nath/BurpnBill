-- QR orders wait for staff to accept them before the kitchen ever sees them.
--
-- Modelled as a nullable timestamp rather than a new `order_status` value on
-- purpose. Adding an enum value would mean rewriting the status state-machine
-- trigger that every other feature already depends on, on a live database,
-- and every `status in (...)` query in the codebase would need revisiting.
-- A column composes with that machine instead of changing it: an order's
-- status lifecycle is exactly what it was, it simply isn't shown to the
-- kitchen until someone accepts it.
alter table public.orders add column approved_at timestamptz;

comment on column public.orders.approved_at is
  'When staff accepted a QR order into the kitchen. Null = still waiting in the POS queue. Staff-placed (POS) orders are approved at creation — the person placing it is the person who would approve it.';

-- Everything that already exists predates the queue and is already cooking,
-- cooked, or paid for. Backfilling from placed_at rather than now() keeps the
-- column honest if it is ever used for timing.
update public.orders set approved_at = placed_at where approved_at is null;

-- The POS approval queue: oldest first, and only ever a handful of live rows,
-- so a partial index keeps it off the main dashboard index.
create index orders_pending_approval_idx
  on public.orders (restaurant_id, placed_at)
  where approved_at is null and status = 'placed';
