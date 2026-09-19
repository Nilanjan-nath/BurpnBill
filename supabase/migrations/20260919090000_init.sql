-- =============================================================================
-- QR Cafe Ordering — initial schema
-- Build order step 1: Database schema
--
-- Safe to run on a fresh Supabase project (Postgres 15+).
-- Idempotent-ish: uses `if not exists` where Postgres allows it, but this is
-- intended to run exactly once, as the first migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Helpers
-- -----------------------------------------------------------------------------

-- Opaque, unguessable public token (32 hex chars / 122 bits of entropy).
-- Used for QR codes so table numbers can't be enumerated.
create or replace function public.generate_opaque_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

create type public.order_status   as enum ('placed', 'preparing', 'ready', 'served', 'cancelled');
create type public.cart_status    as enum ('open', 'converted', 'abandoned');
create type public.payment_method as enum ('cash', 'card', 'upi', 'mock');
create type public.payment_status as enum ('pending', 'succeeded', 'failed');
create type public.staff_role     as enum ('owner', 'staff');

-- -----------------------------------------------------------------------------
-- 2. Tenancy: restaurants + staff
-- -----------------------------------------------------------------------------

create table public.restaurants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  slug          text unique,
  currency_code text not null default 'INR' check (char_length(currency_code) = 3),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.restaurants is 'One row per cafe/tenant. Everything else scopes to restaurant_id.';

-- Maps an authenticated Supabase Auth user to the restaurant they may act on.
-- Required by the security model: "every staff query must be scoped by the
-- authenticated user's restaurant_id".
create table public.staff_members (
  user_id       uuid primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role          public.staff_role not null default 'staff',
  display_name  text,
  created_at    timestamptz not null default now()
);

create index staff_members_restaurant_idx on public.staff_members (restaurant_id);

-- Link to auth.users only when running against Supabase (auth schema present),
-- so this file also applies cleanly to a plain Postgres instance.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    alter table public.staff_members
      add constraint staff_members_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Tables (physical cafe tables) — the QR target
-- -----------------------------------------------------------------------------

create table public.restaurant_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label         text not null check (length(btrim(label)) > 0),
  qr_token      text not null unique default public.generate_opaque_token(),
  seats         smallint check (seats is null or seats > 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint restaurant_tables_label_unique unique (restaurant_id, label),
  -- composite-FK target: lets children prove they belong to the same tenant
  constraint restaurant_tables_id_restaurant_unique unique (id, restaurant_id)
);

comment on column public.restaurant_tables.qr_token is
  'Opaque token encoded in the QR code. Never expose the table label/number in the URL.';

-- -----------------------------------------------------------------------------
-- 4. Menu
-- -----------------------------------------------------------------------------

create table public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  description   text,
  category      text not null default 'Uncategorised',
  price         numeric(10, 2) not null check (price >= 0),
  is_available  boolean not null default true,
  is_veg        boolean,
  image_url     text,
  sort_order    integer not null default 0,
  deleted_at    timestamptz,                   -- soft delete (DELETE /items/:id)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.menu_items.is_available is
  '86 toggle. Unavailable items must never be rendered as orderable.';

-- Customer menu read: the hot path. Partial index keeps it to live rows only.
create index menu_items_public_read_idx
  on public.menu_items (restaurant_id, category, sort_order, name)
  where deleted_at is null and is_available;

-- Owner admin list (includes 86'd items, excludes deleted ones).
create index menu_items_admin_read_idx
  on public.menu_items (restaurant_id, category, sort_order)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- 5. Guest sessions — one per QR scan, no login
-- -----------------------------------------------------------------------------

create table public.guest_sessions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  table_id      uuid not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '3 hours'),
  constraint guest_sessions_table_fkey
    foreign key (table_id, restaurant_id)
    references public.restaurant_tables (id, restaurant_id) on delete cascade,
  -- composite-FK target: children prove they belong to the same table
  constraint guest_sessions_id_table_unique unique (id, table_id)
);

comment on table public.guest_sessions is
  'Created per QR scan. Keeps two customers at the same table from sharing an order. '
  'Rows are never deleted (orders reference them); expiry is logical, via expires_at.';

create index guest_sessions_table_idx on public.guest_sessions (table_id, created_at desc);
create index guest_sessions_expiry_idx on public.guest_sessions (expires_at);

-- -----------------------------------------------------------------------------
-- 6. Cart (server-side, keyed by guest session)
-- -----------------------------------------------------------------------------

create table public.carts (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  table_id         uuid not null,
  guest_session_id uuid not null,
  status           public.cart_status not null default 'open',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint carts_table_fkey
    foreign key (table_id, restaurant_id)
    references public.restaurant_tables (id, restaurant_id) on delete cascade,
  constraint carts_session_fkey
    foreign key (guest_session_id, table_id)
    references public.guest_sessions (id, table_id) on delete cascade
);

-- At most one open cart per guest session.
create unique index carts_one_open_per_session_idx
  on public.carts (guest_session_id)
  where status = 'open';

create table public.cart_items (
  id                   uuid primary key default gen_random_uuid(),
  cart_id              uuid not null references public.carts (id) on delete cascade,
  menu_item_id         uuid not null references public.menu_items (id) on delete restrict,
  quantity             integer not null check (quantity > 0 and quantity <= 99),
  special_instructions text check (special_instructions is null
                                   or char_length(special_instructions) <= 280),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.cart_items is
  'No unique constraint on (cart_id, menu_item_id): the same item with different '
  'special instructions is a distinct line. The API merges lines when notes match.';

create index cart_items_cart_idx on public.cart_items (cart_id);

-- -----------------------------------------------------------------------------
-- 7. Orders
-- -----------------------------------------------------------------------------

create sequence public.order_number_seq start with 1001;

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     bigint not null unique default nextval('public.order_number_seq'),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  table_id         uuid not null,
  guest_session_id uuid not null,
  cart_id          uuid references public.carts (id) on delete set null,
  status           public.order_status not null default 'placed',
  subtotal         numeric(10, 2) not null default 0 check (subtotal >= 0),
  tax_amount       numeric(10, 2) not null default 0 check (tax_amount >= 0),
  total_amount     numeric(10, 2) not null default 0 check (total_amount >= 0),
  notes            text,
  paid_at          timestamptz,                -- null = unpaid; set when a payment succeeds
  placed_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint orders_table_fkey
    foreign key (table_id, restaurant_id)
    references public.restaurant_tables (id, restaurant_id) on delete cascade,
  constraint orders_session_fkey
    foreign key (guest_session_id, table_id)
    references public.guest_sessions (id, table_id) on delete restrict,
  constraint orders_id_restaurant_unique unique (id, restaurant_id)
);

comment on column public.orders.order_number is 'Short human-facing number for the dashboard (#1001).';
comment on column public.orders.paid_at is 'Denormalised from payments; kept in sync by a trigger.';

-- Dashboard initial load: GET /orders?status=&table_id=
create index orders_dashboard_idx on public.orders (restaurant_id, status, placed_at desc);
create index orders_table_idx on public.orders (table_id, placed_at desc);
create index orders_session_idx on public.orders (guest_session_id, placed_at desc);

create table public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  menu_item_id         uuid not null references public.menu_items (id) on delete restrict,
  name_at_order        text not null,
  price_at_order       numeric(10, 2) not null check (price_at_order >= 0),
  quantity             integer not null check (quantity > 0 and quantity <= 99),
  special_instructions text check (special_instructions is null
                                   or char_length(special_instructions) <= 280),
  line_total           numeric(12, 2) generated always as (price_at_order * quantity) stored,
  created_at           timestamptz not null default now()
);

comment on column public.order_items.price_at_order is
  'Price snapshot. Historical orders must not drift when the menu price changes.';

create index order_items_order_idx on public.order_items (order_id);

-- -----------------------------------------------------------------------------
-- 8. Order status state machine
--   placed    -> preparing | cancelled
--   preparing -> ready     | cancelled
--   ready     -> served
-- Enforced in the API (400) AND here, as a backstop.
-- -----------------------------------------------------------------------------

create table public.order_status_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  changed_by  uuid,                             -- staff user id when known
  created_at  timestamptz not null default now()
);

create index order_status_events_order_idx on public.order_status_events (order_id, created_at);

create or replace function public.enforce_order_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if not (
         (old.status = 'placed'    and new.status in ('preparing', 'cancelled'))
      or (old.status = 'preparing' and new.status in ('ready', 'cancelled'))
      or (old.status = 'ready'     and new.status = 'served')
    ) then
      raise exception 'invalid order status transition: % -> %', old.status, new.status
        using errcode = '23514';               -- check_violation -> HTTP 400
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.log_order_status_event()
returns trigger
language plpgsql
as $$
declare
  actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_events (order_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, actor);
  elsif new.status is distinct from old.status then
    insert into public.order_status_events (order_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, actor);
  end if;
  return null;
end;
$$;

create trigger orders_status_transition_guard
  before update of status on public.orders
  for each row execute function public.enforce_order_status_transition();

create trigger orders_status_event_log
  after insert or update of status on public.orders
  for each row execute function public.log_order_status_event();

-- -----------------------------------------------------------------------------
-- 9. Payments
-- -----------------------------------------------------------------------------

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  order_id        uuid not null,
  idempotency_key text not null unique,
  method          public.payment_method not null default 'mock',
  status          public.payment_status not null default 'pending',
  amount          numeric(10, 2) not null check (amount >= 0),
  provider_ref    text,
  failure_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint payments_order_fkey
    foreign key (order_id, restaurant_id)
    references public.orders (id, restaurant_id) on delete cascade
);

comment on column public.payments.idempotency_key is
  'Client-supplied. Unique constraint is what makes POST /payments idempotent.';

create index payments_order_idx on public.payments (order_id, created_at desc);

-- An order can have many payment attempts, but only one that succeeded.
create unique index payments_one_success_per_order_idx
  on public.payments (order_id)
  where status = 'succeeded';

create or replace function public.sync_order_paid_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'succeeded' then
    update public.orders
       set paid_at = coalesce(paid_at, now())
     where id = new.order_id;
  end if;
  return null;
end;
$$;

create trigger payments_sync_order_paid_at
  after insert or update of status on public.payments
  for each row execute function public.sync_order_paid_at();

-- -----------------------------------------------------------------------------
-- 10. updated_at triggers
-- -----------------------------------------------------------------------------

create trigger restaurants_set_updated_at       before update on public.restaurants       for each row execute function public.set_updated_at();
create trigger restaurant_tables_set_updated_at before update on public.restaurant_tables for each row execute function public.set_updated_at();
create trigger menu_items_set_updated_at        before update on public.menu_items        for each row execute function public.set_updated_at();
create trigger carts_set_updated_at             before update on public.carts             for each row execute function public.set_updated_at();
create trigger cart_items_set_updated_at        before update on public.cart_items        for each row execute function public.set_updated_at();
create trigger orders_set_updated_at            before update on public.orders            for each row execute function public.set_updated_at();
create trigger payments_set_updated_at          before update on public.payments          for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 11. Lock the door: RLS on, no policies
--
-- Supabase grants the public `anon` key access to tables in the public schema.
-- With RLS enabled and zero policies, every one of these tables is deny-all for
-- anon + authenticated. The Express backend uses the service_role key, which
-- bypasses RLS, so this changes nothing for us — it only stops the anon key
-- (which ships in frontend JS) from reading or writing anything directly.
-- Writing real policies for direct client access is the deferred hardening pass.
-- -----------------------------------------------------------------------------

alter table public.restaurants        enable row level security;
alter table public.staff_members      enable row level security;
alter table public.restaurant_tables  enable row level security;
alter table public.menu_items         enable row level security;
alter table public.guest_sessions     enable row level security;
alter table public.carts              enable row level security;
alter table public.cart_items         enable row level security;
alter table public.orders             enable row level security;
alter table public.order_items        enable row level security;
alter table public.order_status_events enable row level security;
alter table public.payments           enable row level security;
