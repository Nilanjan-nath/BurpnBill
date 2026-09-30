-- How food reaches the customer, so the order-status line can say something
-- true. "Ready" means two different things in a café: at a table-service place
-- someone still has to carry it out, and at a self-service one the customer has
-- to come and get it. Promising the wrong one is worse than saying nothing.
--
-- A constrained text column rather than an enum type: a third mode later is a
-- one-line check change, not an ALTER TYPE on a live database, and the
-- existing rows need no backfill because the default is the current behaviour
-- (staff bring it to the table).

alter table public.restaurants
  add column service_mode text not null default 'table'
    check (service_mode in ('table', 'counter'));

comment on column public.restaurants.service_mode is
  '''table'': staff bring the order to the table. ''counter'': the customer collects it when it is ready. Only changes the wording of "Ready" shown to the customer.';
