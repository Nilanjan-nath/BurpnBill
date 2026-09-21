import { unauthorized, forbidden } from '../errors.js';

// Staff/owner routes. Verifies the Supabase access token, then looks up which
// restaurant this user works for. Every staff handler scopes its queries by
// req.staff.restaurantId — never by an id taken from the request.
//
//   req.staff = { userId, restaurantId, role: 'owner' | 'staff', displayName }
export function createRequireStaff({ supabase, db }) {
  return async function requireStaff(req, res, next) {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) throw unauthorized('Session expired or invalid — sign in again');

    const { rows } = await db.query(
      `select sm.restaurant_id, sm.role, sm.display_name
         from public.staff_members sm
         join public.restaurants r on r.id = sm.restaurant_id
        where sm.user_id = $1 and r.is_active`,
      [data.user.id],
    );
    if (!rows.length) throw forbidden('This account is not linked to an active restaurant');

    req.staff = {
      userId: data.user.id,
      restaurantId: rows[0].restaurant_id,
      role: rows[0].role,
      displayName: rows[0].display_name,
    };
    next();
  };
}

export function requireOwner(req, res, next) {
  if (req.staff?.role !== 'owner') throw forbidden('Only the owner can do this');
  next();
}
