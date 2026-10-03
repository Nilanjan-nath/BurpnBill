-- Platform admin: what BurpnBill itself needs to run as a business.
--
-- Until now the schema knew about cafés and their orders and nothing about BurpnBill
-- being paid. This adds, in one place:
--
--   1. orders.source        which door an order came through (QR or the POS), recorded
--                           outright instead of guessed from "has a cart_id"
--   2. restaurants          a trial clock, a paid-until date, and the owner's contact email
--   3. subscription_payments  money received from a café, with a numbered invoice
--   4. subscription_events    a small audit trail for trial extensions and payments
--   5. platform_admins      the people allowed into /admin (just the owner, inserted by hand)
--
-- Nothing here locks anyone out. The columns let the app COMPUTE a café's plan state
-- (trialing / active / grace / locked); enforcing it is a separate, later change.

-- -----------------------------------------------------------------------------
-- 1. Where an order came from
-- -----------------------------------------------------------------------------
-- The dashboard has been inferring QR vs counter from `cart_id is not null`: a
-- customer's order is converted from a cart, a POS order never has one. That works,
-- but cart_id is `on delete set null`, so cleaning up old carts would quietly turn
-- QR orders into "POS" ones. Reports that people are billed and judged on should not
-- rest on that, so the fact is stored.
create type public.order_source as enum ('qr', 'pos');

alter table public.orders
  add column source public.order_source not null default 'qr';

-- Every existing order: it had a cart if it came from a phone.
update public.orders set source = case when cart_id is null then 'pos' else 'qr' end::public.order_source;

comment on column public.orders.source is
  'qr = placed by a customer from their phone; pos = rung up by staff. Set by the API when the order is created.';

create index orders_source_idx on public.orders (restaurant_id, source, placed_at desc);

-- -----------------------------------------------------------------------------
-- 2. The trial clock and the plan
-- -----------------------------------------------------------------------------
-- trial_ends_at: 14 days from creation. paid_until: the end of the latest paid period
-- (null = never paid). Plan state is derived from these two plus the current time
-- (server/src/services/platform.js), never stored, so it cannot go stale.
alter table public.restaurants
  add column trial_ends_at timestamptz not null default (now() + interval '14 days'),
  add column paid_until    timestamptz,
  add column owner_email   text;

-- Cafés that already exist: their 14 days run from when they were created.
update public.restaurants set trial_ends_at = created_at + interval '14 days';

comment on column public.restaurants.trial_ends_at is 'End of the free trial. Extendable by the platform admin.';
comment on column public.restaurants.paid_until is 'End of the latest paid period; null if this cafe has never paid.';
comment on column public.restaurants.owner_email is 'The email of whoever created the cafe, so the platform admin can reach them. Contact detail only; it grants nothing.';

-- Fill owner_email for cafés that exist already, from the owner's login. Only on
-- Supabase (the auth schema is there), like the staff_members foreign key in init.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    update public.restaurants r
       set owner_email = u.email
      from (
        select distinct on (sm.restaurant_id) sm.restaurant_id, au.email
          from public.staff_members sm
          join auth.users au on au.id = sm.user_id
         where sm.role = 'owner'
         order by sm.restaurant_id, sm.created_at
      ) u
     where u.restaurant_id = r.id and r.owner_email is null;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Money received from cafés
-- -----------------------------------------------------------------------------
-- One row per payment BurpnBill has been paid, recorded by hand after the money has
-- landed (UPI or bank transfer). `invoice_seq` is the invoice number (shown as
-- BNB-0001); it comes from an identity column, so two payments recorded at once
-- cannot share one.
--
-- Like a bill, the invoice is a SNAPSHOT: `snapshot` holds the café's and the seller's
-- details as they were, so a reprint next year shows what was sent then.
--
-- A financial record is never deleted by deleting a café: ON DELETE RESTRICT.
create table public.subscription_payments (
  id            uuid primary key default gen_random_uuid(),
  invoice_seq   bigint generated always as identity,
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  amount        numeric(10, 2) not null check (amount > 0),
  currency_code text not null default 'INR' check (char_length(currency_code) = 3),
  method        text not null check (method in ('upi', 'bank_transfer', 'cash', 'other')),
  -- The UTR / transaction reference the café sent. Optional for cash.
  reference     text check (reference is null or length(btrim(reference)) > 0),
  paid_on       date not null default current_date,
  plan_months   integer not null default 6 check (plan_months between 1 and 36),
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  note          text,
  snapshot      jsonb not null,
  recorded_by   uuid,
  created_at    timestamptz not null default now(),
  constraint subscription_payments_period_ok check (period_end > period_start),
  constraint subscription_payments_invoice_key unique (invoice_seq)
);

-- The same transaction reference twice is the same payment recorded twice, whichever
-- café it was typed against. Cash has no reference and is not covered.
create unique index subscription_payments_reference_key
  on public.subscription_payments (lower(method), lower(reference))
  where reference is not null;

create index subscription_payments_restaurant_idx
  on public.subscription_payments (restaurant_id, created_at desc);

comment on table public.subscription_payments is
  'Money received from cafes for a BurpnBill plan, recorded by the platform admin. One row = one numbered invoice.';

-- -----------------------------------------------------------------------------
-- 4. Audit trail
-- -----------------------------------------------------------------------------
create table public.subscription_events (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind          text not null check (kind in ('trial_extended', 'payment_recorded')),
  data          jsonb not null default '{}'::jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create index subscription_events_restaurant_idx on public.subscription_events (restaurant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 5. Who may open /admin
-- -----------------------------------------------------------------------------
-- A table, not a role on staff_members: a platform admin is not a member of any
-- café, and staff_members' primary key already means "one person, one café". Rows
-- are inserted by hand (see DEPLOY.md); there is deliberately no API to add one.
create table public.platform_admins (
  user_id    uuid primary key,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Login users allowed into the platform admin area. Insert by hand; no API creates rows here.';

alter table public.subscription_payments enable row level security;
alter table public.subscription_events enable row level security;
alter table public.platform_admins enable row level security;
