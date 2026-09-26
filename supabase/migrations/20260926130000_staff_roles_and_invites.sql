-- Three roles instead of two, and a way to add someone who hasn't signed up yet.
--
-- 'kitchen' splits the old catch-all 'staff' in two: 'staff' is now front of
-- house (the order board, 86'ing items, and POS — taking walk-ins, accepting
-- QR orders, settling a table), while 'kitchen' keeps exactly what 'staff'
-- could do before. Existing rows need no backfill: 'staff' means what it
-- always did plus POS, which is the intended widening — before this, QR
-- orders could only be accepted by the owner.
alter type public.staff_role add value if not exists 'kitchen';

-- staff_members.user_id is the primary key and, on Supabase, a foreign key to
-- auth.users — so someone must already exist as an auth user before they can
-- be linked to a cafe. An invite is therefore a pre-authorised email rather
-- than a row in staff_members: the person signs up themselves, and the first
-- authenticated request matching this email claims the invite (see
-- middleware/auth.js).
--
-- The email is only as trustworthy as Supabase's own "Confirm email" setting,
-- which is what actually proves the person owns the inbox. Expiry and
-- revocation keep the window small either way.
create table public.staff_invites (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  email         text not null check (position('@' in email) > 1),
  role          public.staff_role not null default 'staff',
  display_name  text,
  invited_by    uuid,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  accepted_by   uuid
);

comment on table public.staff_invites is
  'Pre-authorised email addresses. Claimed on the invitee''s first authenticated request; see middleware/auth.js.';

-- One open invite per email per cafe. Accepted ones stay as history, so the
-- partial index has to allow duplicates once accepted_at is set.
create unique index staff_invites_open_email_idx
  on public.staff_invites (restaurant_id, lower(email))
  where accepted_at is null;

-- The claim lookup: by email, across cafes, open invites only.
create index staff_invites_claim_idx
  on public.staff_invites (lower(email))
  where accepted_at is null;
