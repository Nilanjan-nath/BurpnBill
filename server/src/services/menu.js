import { HttpError, notFound } from '../errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /menu/:qrToken
//
// Resolves the table, starts a guest session (or keeps the caller's, if it is
// still live and for this same table), and returns the menu. Only live items
// are read — the partial index menu_items_public_read_idx covers exactly that.
export async function openMenu(db, { qrToken, sessionHeader, sessionTtlHours }) {
  const { rows: tables } = await db.query(
    `select t.id as table_id, t.label, t.restaurant_id, r.name as restaurant_name,
            r.currency_code, (t.is_active and r.is_active) as ordering_open
       from public.restaurant_tables t
       join public.restaurants r on r.id = t.restaurant_id
      where t.qr_token = $1`,
    [qrToken],
  );
  const table = tables[0];
  if (!table) throw notFound('This QR code is not recognised');
  if (!table.ordering_open) {
    throw new HttpError(403, 'ordering_unavailable', 'Ordering is not available at this table right now');
  }

  const session = await reuseOrCreateSession(db, table, sessionHeader, sessionTtlHours);
  const { rows: placed } = await db.query(
    'select exists (select 1 from public.orders where guest_session_id = $1) as has_orders',
    [session.id],
  );

  const { rows: items } = await db.query(
    `select id, name, description, category, price, is_veg, image_url
       from public.menu_items
      where restaurant_id = $1 and deleted_at is null and is_available
      order by category, sort_order, name`,
    [table.restaurant_id],
  );

  return {
    restaurant: { name: table.restaurant_name, currency_code: table.currency_code },
    table: { label: table.label },
    session: { ...session, has_orders: placed[0].has_orders },
    categories: groupByCategory(items),
  };
}

async function reuseOrCreateSession(db, table, sessionHeader, ttlHours) {
  if (sessionHeader && UUID.test(sessionHeader)) {
    const { rows } = await db.query(
      `update public.guest_sessions
          set last_seen_at = now(), expires_at = now() + make_interval(hours => $3)
        where id = $1 and table_id = $2 and expires_at > now()
        returning id, expires_at`,
      [sessionHeader, table.table_id, ttlHours],
    );
    if (rows[0]) return { id: rows[0].id, expires_at: rows[0].expires_at };
  }

  const { rows } = await db.query(
    `insert into public.guest_sessions (restaurant_id, table_id, expires_at)
     values ($1, $2, now() + make_interval(hours => $3))
     returning id, expires_at`,
    [table.restaurant_id, table.table_id, ttlHours],
  );
  return { id: rows[0].id, expires_at: rows[0].expires_at };
}

// Rows arrive ordered by category, so a Map keeps that order.
function groupByCategory(items) {
  const byCategory = new Map();
  for (const { category, ...item } of items) {
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(item);
  }
  return [...byCategory].map(([name, list]) => ({ name, items: list }));
}
