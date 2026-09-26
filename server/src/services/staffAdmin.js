import { badRequest, notFound } from '../errors.js';

// Staff management (step 6 slice 5) — owner only. Three roles:
//   owner   — everything, including this screen
//   staff   — front of house: the order board, 86'ing items, and POS
//   kitchen — the order board and 86'ing items
export const ROLES = ['owner', 'staff', 'kitchen'];

// GET /staff — who works here, plus the invites still waiting to be claimed.
// Both in one response because the screen shows them as one list: an invited
// person is "here but hasn't signed up yet", not a separate concept.
export async function listStaff(db, restaurantId) {
  const [{ rows: members }, { rows: invites }] = await Promise.all([
    db.query(
      `select user_id, role, display_name, created_at
         from public.staff_members
        where restaurant_id = $1
        order by (role <> 'owner'), created_at`,
      [restaurantId],
    ),
    db.query(
      `select id, email, role, display_name, created_at, expires_at,
              (expires_at <= now()) as expired
         from public.staff_invites
        where restaurant_id = $1 and accepted_at is null
        order by created_at`,
      [restaurantId],
    ),
  ]);
  return { members, invites };
}

// POST /staff/invites — pre-authorise an email. No email is sent: the person
// signs up with this address themselves and is linked on their first
// authenticated request (see middleware/auth.js). Re-inviting the same address
// replaces the open invite rather than erroring, because "invite them again"
// is what someone means when the first one expired or had the wrong role.
export async function inviteStaff(db, restaurantId, invitedBy, { email, role, display_name }) {
  // No "are they already on the team?" check: staff_members has no email
  // column — the address lives in auth.users, which only exists on Supabase,
  // not in the tests' Postgres. An invite for someone already linked simply
  // never gets claimed (they resolve by user_id long before the invite path
  // runs), and the owner can revoke it. Worth keeping portable over clever.
  const normalised = email.trim().toLowerCase();

  const { rows } = await db.query(
    `insert into public.staff_invites (restaurant_id, email, role, display_name, invited_by)
     values ($1, $2, $3, $4, $5)
     on conflict (restaurant_id, lower(email)) where accepted_at is null
     do update set role = excluded.role,
                   display_name = excluded.display_name,
                   invited_by = excluded.invited_by,
                   created_at = now(),
                   expires_at = now() + interval '7 days'
     returning id, email, role, display_name, created_at, expires_at, false as expired`,
    [restaurantId, normalised, role, display_name ?? null, invitedBy],
  );
  return rows[0];
}

// DELETE /staff/invites/:inviteId — withdraw one that hasn't been claimed.
export async function revokeInvite(db, restaurantId, inviteId) {
  const { rowCount } = await db.query(
    `delete from public.staff_invites
      where id = $1 and restaurant_id = $2 and accepted_at is null`,
    [inviteId, restaurantId],
  );
  if (!rowCount) throw notFound('Invite not found');
}

// PATCH /staff/:userId — change someone's role.
// DELETE /staff/:userId — unlink them from this cafe. Their Supabase Auth
// account is left alone: that identity may be used elsewhere, and deleting it
// is not this app's business.
//
// Both refuse to remove the last owner. A cafe with no owner has no one who
// can manage the menu, the tables, or this screen — including no one who can
// put an owner back — so it is a door that locks from the outside.
export async function updateStaffRole(db, restaurantId, userId, role) {
  if (await wouldStrandCafe(db, restaurantId, userId, role)) {
    throw badRequest('This is the only owner — make someone else an owner first');
  }
  const { rows } = await db.query(
    `update public.staff_members set role = $3
      where user_id = $1 and restaurant_id = $2
      returning user_id, role, display_name, created_at`,
    [userId, restaurantId, role],
  );
  if (!rows.length) throw notFound('Staff member not found');
  return rows[0];
}

export async function removeStaff(db, restaurantId, userId) {
  if (await wouldStrandCafe(db, restaurantId, userId, null)) {
    throw badRequest('This is the only owner — make someone else an owner first');
  }
  const { rowCount } = await db.query(
    `delete from public.staff_members where user_id = $1 and restaurant_id = $2`,
    [userId, restaurantId],
  );
  if (!rowCount) throw notFound('Staff member not found');
}

// True when this change would leave the cafe with no owner at all. `newRole`
// is null for a removal.
async function wouldStrandCafe(db, restaurantId, userId, newRole) {
  if (newRole === 'owner') return false;
  const { rows } = await db.query(
    `select count(*)::int as owners,
            count(*) filter (where user_id = $2)::int as is_target_owner
       from public.staff_members
      where restaurant_id = $1 and role = 'owner'`,
    [restaurantId, userId],
  );
  return rows[0].owners === 1 && rows[0].is_target_owner === 1;
}
