-- The café's own details, for the Settings screen.
--
-- `name` and `currency_code` were already here from the start; these are the
-- two the owner had nowhere to put. Both are nullable free text: a café that
-- hasn't filled them in is a normal state, not an incomplete record, and
-- nothing in the app depends on either being present.
--
-- Deliberately NOT added: a tax rate. `orders.tax_amount` exists and is always
-- 0, and applying a rate is a change to how every order is priced — the bill,
-- checkout and the dashboard's takings all read those totals — not a settings
-- field. It stays out of scope (ARCHITECTURE §2) until that work is done, so
-- that no screen can promise a tax nothing charges.

alter table public.restaurants
  add column address text,
  add column phone   text;

comment on column public.restaurants.address is
  'Shown on receipts and the printed QR sheet. Free text — one line or several, whatever the café writes.';

comment on column public.restaurants.phone is
  'Contact number for receipts. Stored exactly as typed: formats vary by country and normalising them would only lose information.';
