-- Bills: one per settled table.
--
-- Until now, settling a table wrote one `payments` row per order and nothing
-- that said "this was one bill". There was no bill number, and nowhere to keep
-- what a receipt needs to say (the lines, the café's details, cash tendered and
-- change). A bill is that record.
--
-- It is a SNAPSHOT, deliberately: the lines are copied, and the café's name,
-- address and phone are copied, so a reprint next year shows what the customer
-- was handed even if the menu prices or the café's details have changed since.
--
-- Bill numbers are consecutive per café (1, 2, 3, ...), taken from a counter on
-- the restaurant row inside the checkout transaction, so two tills settling at
-- once cannot get the same number and a failed checkout does not leave a hole.
--
-- Not here yet (later phases, docs/TASKS.md Step 14): tax columns beyond a zero
-- placeholder, discounts, the public digital-receipt token, voiding.

alter table public.restaurants
  add column bill_counter bigint not null default 0;

comment on column public.restaurants.bill_counter is
  'Last bill number issued for this cafe. Incremented inside the checkout transaction; the next bill is this + 1.';

create table public.bills (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  bill_number        bigint not null check (bill_number > 0),
  idempotency_key    text not null,
  table_id           uuid,
  table_label        text not null,
  -- The café as it was when the bill was printed.
  restaurant_name    text not null,
  restaurant_address text,
  restaurant_phone   text,
  currency_code      text not null check (char_length(currency_code) = 3),
  payment_method     public.payment_method not null,
  subtotal           numeric(10, 2) not null check (subtotal >= 0),
  tax_amount         numeric(10, 2) not null default 0 check (tax_amount >= 0),
  total_amount       numeric(10, 2) not null check (total_amount >= 0),
  -- Cash only: what the customer handed over, and the change given back.
  amount_tendered    numeric(10, 2) check (amount_tendered >= 0),
  change_given       numeric(10, 2) check (change_given >= 0),
  settled_by         uuid,
  settled_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  constraint bills_number_key unique (restaurant_id, bill_number),
  -- A retried Confirm finds its bill instead of making a second one.
  constraint bills_idempotency_key unique (restaurant_id, idempotency_key),
  constraint bills_tendered_covers_total check (amount_tendered is null or amount_tendered >= total_amount)
);

create index bills_settled_idx on public.bills (restaurant_id, settled_at desc);

create table public.bill_lines (
  id                   uuid primary key default gen_random_uuid(),
  bill_id              uuid not null references public.bills (id) on delete cascade,
  restaurant_id        uuid not null references public.restaurants (id) on delete cascade,
  -- Which order (round) the line came from, as the dashboard numbers it (#1001).
  order_number         bigint not null,
  name                 text not null,
  quantity             integer not null check (quantity > 0),
  unit_price           numeric(10, 2) not null check (unit_price >= 0),
  line_total           numeric(10, 2) not null check (line_total >= 0),
  special_instructions text,
  sort_order           integer not null default 0
);

create index bill_lines_bill_idx on public.bill_lines (bill_id, sort_order);

-- Which bill a payment belongs to. Nullable: payments from before this
-- migration have no bill and keep working exactly as they did.
alter table public.payments
  add column bill_id uuid references public.bills (id);

create index payments_bill_idx on public.payments (bill_id) where bill_id is not null;

alter table public.bills enable row level security;
alter table public.bill_lines enable row level security;
