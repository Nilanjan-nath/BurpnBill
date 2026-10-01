-- The digital receipt (docs/TASKS.md Step 14, phase C).
--
-- The QR on a printed receipt opens /r/<token>, a read-only page with the same
-- bill. No login, so the token IS the access: 32 hex characters (122 bits) from
-- the same generator the table QR codes use, unguessable, one per bill. It is
-- separate from bills.id on purpose, so the internal id never has to leave the
-- building and a token can be reissued later without touching the bill.
--
-- Bills made before this migration get a token too: a column default that is
-- volatile is evaluated per row when it is added.

alter table public.bills
  add column public_token text not null default public.generate_opaque_token();

alter table public.bills
  add constraint bills_public_token_key unique (public_token);
