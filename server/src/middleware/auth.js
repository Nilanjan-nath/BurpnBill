import { unauthorized, forbidden } from '../errors.js';

// Staff/owner routes. Verifies the Supabase access token, then looks up which
// restaurant this user works for. Every staff handler scopes its queries by
// req.staff.restaurantId — never by an id taken from the request.
//
//   req.staff = { userId, restaurantId, restaurantName, role, displayName }
//   role: 'owner' | 'staff' | 'kitchen'
//
// The café's NAME rides along with its id because the dashboard shows it as the
// thing you are signed in to — see Sidebar.jsx. It costs nothing: the join onto
// restaurants was already here for the is_active check.
export function createRequireStaff({ supabase, db }) {
  return async function requireStaff(req, res, next) {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) throw unauthorized('Session expired or invalid — sign in again');

    let { rows } = await db.query(
      `select sm.restaurant_id, sm.role, sm.display_name, r.name as restaurant_name
         from public.staff_members sm
         join public.restaurants r on r.id = sm.restaurant_id
        where sm.user_id = $1 and r.is_active`,
      [data.user.id],
    );

    // Not linked yet? They may have been invited before they signed up, in
    // which case this is their first request and the invite is waiting for
    // them. The email comes from the verified Supabase user, never from the
    // request — so this is only as strong as Supabase's own "Confirm email"
    // setting, which is what proves they own the inbox.
    if (!rows.length && data.user.email) {
      rows = await claimInvite(db, data.user);
    }
    if (!rows.length) throw forbidden('This account is not linked to an active restaurant');

    req.staff = {
      userId: data.user.id,
      restaurantId: rows[0].restaurant_id,
      restaurantName: rows[0].restaurant_name,
      role: rows[0].role,
      displayName: rows[0].display_name,
    };
    next();
  };
}

// One statement, so two simultaneous first-requests can't both link. The
// unique index on open invites keeps there being at most one to claim, and
// staff_members.user_id being the primary key makes the insert idempotent.
async function claimInvite(db, user) {
  const fallbackName = user.email.split('@')[0];
  const { rows } = await db.query(
    `with open_invite as (
       select i.id, i.restaurant_id, i.role, i.display_name
         from public.staff_invites i
         join public.restaurants r on r.id = i.restaurant_id
        where lower(i.email) = lower($2)
          and i.accepted_at is null
          and i.expires_at > now()
          and r.is_active
        order by i.created_at
        limit 1
     ), linked as (
       insert into public.staff_members (user_id, restaurant_id, role, display_name)
       select $1, restaurant_id, role, coalesce(display_name, $3)
         from open_invite
       on conflict (user_id) do nothing
       returning restaurant_id, role, display_name
     ), claimed as (
       update public.staff_invites
          set accepted_at = now(), accepted_by = $1
        where id in (select id from open_invite)
          and exists (select 1 from linked)
       returning id
     )
     select l.restaurant_id, l.role, l.display_name, r.name as restaurant_name
       from linked l
       join public.restaurants r on r.id = l.restaurant_id`,
    [user.id, user.email, fallbackName],
  );
  return rows;
}

// A verified Supabase user who may not belong to any café yet — the one state
// requireStaff exists to reject. Signing up creates an auth account and nothing
// else (see ARCHITECTURE §6: an invite is a pre-authorised email, not an
// account), so the person who arrives with no invite waiting has to be able to
// create a café of their own. That request is authenticated but not staffed.
//
// The user id and email come off the VERIFIED token, never off the request —
// the same rule the invite claim follows, and for the same reason.
export function createRequireAuthUser({ supabase }) {
  return async function requireAuthUser(req, res, next) {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) throw unauthorized('Session expired or invalid — sign in again');

    req.authUser = { id: data.user.id, email: data.user.email ?? null };
    next();
  };
}

// The platform owner's area (/api/admin). Not a role inside any café: a platform
// admin is a login listed in `platform_admins`, inserted by hand, and being a café's
// owner grants nothing here. Everything behind this reads ACROSS cafés, so this is
// the check the whole area rests on: a valid login that is not listed gets 403, and
// no request value is ever used to decide who is an admin.
export function createRequirePlatformAdmin({ supabase, db }) {
  return async function requirePlatformAdmin(req, res, next) {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) throw unauthorized('Session expired or invalid — sign in again');

    const { rows } = await db.query('select 1 from public.platform_admins where user_id = $1', [data.user.id]);
    if (!rows.length) throw forbidden('Not allowed');

    req.admin = { userId: data.user.id };
    next();
  };
}

export function requireOwner(req, res, next) {
  if (req.staff?.role !== 'owner') throw forbidden('Only the owner can do this');
  next();
}

// The till: POS, the floor, and settling a table. Front of house, not the
// kitchen — a QR order that only the owner can accept is an order that waits
// for the owner to be standing at the till, which is why this exists.
export function requireFrontOfHouse(req, res, next) {
  if (req.staff?.role !== 'owner' && req.staff?.role !== 'staff') {
    throw forbidden('Only the owner or front-of-house staff can do this');
  }
  next();
}
