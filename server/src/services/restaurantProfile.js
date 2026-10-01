import { badRequest } from '../errors.js';

// The café's own profile — the Settings screen's Restaurant Profile view.
//
// Scoped by restaurantId from the signed-in staff member, never from the
// request, like every other staff query here. Reading is open to any staff
// member (the currency alone decides how every price on their screen is
// formatted); only the owner writes.

const PROFILE_COLUMNS =
  'id, name, address, phone, currency_code, service_mode, gst_enabled, gstin, gst_rate, fssai_number';

export async function getRestaurantProfile(db, restaurantId) {
  const { rows } = await db.query(
    `select ${PROFILE_COLUMNS} from public.restaurants where id = $1`,
    [restaurantId],
  );
  return rows[0] ?? null;
}

// PATCH /restaurant — owner only, partial: only the fields present change.
// `address` and `phone` are clearable, so each carries its own "was this sent
// at all" flag — sending null to clear one is deliberately different from
// omitting it. `name` and `currency_code` are not clearable: the database
// refuses a blank name, and a café always trades in some currency.
export async function updateRestaurantProfile(db, restaurantId, input) {
  return db.withTransaction(async (tx) => {
    // GST needs a GSTIN to print: refuse here with a plain message rather than
    // let the database's check constraint answer with its own wording.
    const { rows: current } = await tx.query(`select gst_enabled, gstin from public.restaurants where id = $1 for update`, [restaurantId]);
    if (!current.length) return null;
    const gstEnabled = input.gst_enabled ?? current[0].gst_enabled;
    const gstin = 'gstin' in input ? input.gstin : current[0].gstin;
    if (gstEnabled && !gstin) throw badRequest('Add your GSTIN before turning GST on');

    const { rows } = await tx.query(
      `update public.restaurants
          set name          = coalesce($2, name),
              address       = case when $3::boolean then $4 else address end,
              phone         = case when $5::boolean then $6 else phone end,
              currency_code = coalesce($7, currency_code),
              service_mode  = coalesce($8, service_mode),
              gst_enabled   = coalesce($9, gst_enabled),
              gstin         = case when $10::boolean then $11 else gstin end,
              gst_rate      = coalesce($12, gst_rate),
              fssai_number  = case when $13::boolean then $14 else fssai_number end
        where id = $1
        returning ${PROFILE_COLUMNS}`,
      [
        restaurantId,
        input.name ?? null,
        'address' in input,
        input.address ?? null,
        'phone' in input,
        input.phone ?? null,
        input.currency_code ?? null,
        input.service_mode ?? null,
        input.gst_enabled ?? null,
        'gstin' in input,
        input.gstin ?? null,
        input.gst_rate ?? null,
        'fssai_number' in input,
        input.fssai_number ?? null,
      ],
    );
    return rows[0] ?? null;
  });
}

// PATCH /me — any signed-in staff member, about themselves. The Staff tab is
// how an owner changes someone ELSE's name or role; this is the only way to
// change your own, and it can never touch a role — otherwise the kitchen
// could promote itself.
export async function updateOwnProfile(db, userId, { display_name }) {
  const { rows } = await db.query(
    `update public.staff_members set display_name = $2
      where user_id = $1
      returning user_id, restaurant_id, role, display_name`,
    [userId, display_name],
  );
  return rows[0] ?? null;
}
