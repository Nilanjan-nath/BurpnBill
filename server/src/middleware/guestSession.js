import { HttpError } from '../errors.js';

export const GUEST_SESSION_HEADER = 'X-Guest-Session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Customer write routes (cart, orders). GET /menu/:qrToken hands out the
// session id; the web app sends it back in the X-Guest-Session header.
// Not authentication — it only keeps two diners at one table apart.
//
//   req.guest = { sessionId, tableId, restaurantId }
export function createRequireGuestSession({ db, sessionTtlHours = 3 }) {
  return async function requireGuestSession(req, res, next) {
    const sessionId = req.get(GUEST_SESSION_HEADER);
    if (!sessionId || !UUID.test(sessionId)) {
      throw new HttpError(401, 'guest_session_missing', 'Scan the QR code on your table to start ordering');
    }

    const { rows } = await db.query(
      `select gs.table_id, gs.restaurant_id,
              gs.expires_at > now()      as live,
              t.is_active and r.is_active as ordering_open
         from public.guest_sessions gs
         join public.restaurant_tables t on t.id = gs.table_id
         join public.restaurants r       on r.id = gs.restaurant_id
        where gs.id = $1`,
      [sessionId],
    );
    const session = rows[0];

    if (!session) {
      throw new HttpError(401, 'guest_session_invalid', 'Scan the QR code on your table to start ordering');
    }
    if (!session.live) {
      throw new HttpError(401, 'guest_session_expired', 'Your session has expired — scan the QR code again');
    }
    if (!session.ordering_open) {
      throw new HttpError(403, 'ordering_unavailable', 'Ordering is not available at this table right now');
    }

    // Any activity keeps the session alive for another full TTL: a party that
    // lingers over chai must still be able to open their bill.
    await db.query(
      `update public.guest_sessions
          set last_seen_at = now(), expires_at = now() + make_interval(hours => $2)
        where id = $1`,
      [sessionId, sessionTtlHours],
    );

    req.guest = { sessionId, tableId: session.table_id, restaurantId: session.restaurant_id };
    next();
  };
}
