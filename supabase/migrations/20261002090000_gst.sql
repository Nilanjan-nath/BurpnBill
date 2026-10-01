-- Optional GST (docs/TASKS.md Step 14, phase B).
--
-- Off by default and per café: many small cafés are not GST-registered, and a
-- composition-scheme café must not charge it on its bills. A café that is
-- registered turns it on in Settings and gives its GSTIN.
--
-- Prices are TAX-INCLUSIVE: the menu price is the price paid, and the bill
-- shows the tax inside it. So nothing about how an order is priced changes
-- (orders.tax_amount stays 0, the customer's phone bill and the dashboard's
-- takings read the same totals as before); only the bill, at checkout,
-- splits the total into taxable value + CGST + SGST.
--
--   tax      = total * rate / (100 + rate)      (rounded to the paisa)
--   CGST     = half of it, SGST = the rest      (so they always add up)
--   taxable  = total - tax
--
-- One rate for the whole café. Items taxed at different rates (rare for a
-- café) are not supported yet.

alter table public.restaurants
  add column gst_enabled boolean not null default false,
  add column gstin       text,
  add column gst_rate    numeric(5, 2) not null default 5 check (gst_rate >= 0 and gst_rate <= 28),
  add column fssai_number text;

comment on column public.restaurants.gstin is
  'GST identification number, 15 characters. Required while gst_enabled.';
comment on column public.restaurants.fssai_number is
  'FSSAI food licence number (14 digits). Printed on the bill whether or not GST is on.';

alter table public.restaurants
  add constraint restaurants_gst_needs_gstin check (not gst_enabled or gstin is not null);

-- What the bill says, frozen like the rest of it: a reprint shows the rate and
-- the registration numbers that were true on the day.
alter table public.bills
  add column gstin         text,
  add column fssai_number  text,
  add column tax_rate      numeric(5, 2),
  add column taxable_value numeric(10, 2),
  add column cgst_amount   numeric(10, 2),
  add column sgst_amount   numeric(10, 2);

comment on column public.bills.tax_amount is
  'Total tax on the bill (CGST + SGST when GST was on, else 0). Already inside total_amount: prices are tax-inclusive.';

-- When GST was charged the parts must add up exactly, to the paisa.
alter table public.bills
  add constraint bills_gst_adds_up check (
    tax_rate is null
    or (taxable_value + cgst_amount + sgst_amount = total_amount and cgst_amount + sgst_amount = tax_amount)
  );
