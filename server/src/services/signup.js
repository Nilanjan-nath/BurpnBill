import { HttpError } from '../errors.js';
import { insertStarterMenu } from './starterMenu.js';

// POST /restaurants — someone with a Supabase account and no café creates one,
// and becomes its owner. This is the only way a restaurant comes into being
// outside the seed, and the only write in the API that isn't scoped to a
// restaurant the caller already belongs to — so the guard is the caller's own
// link, checked inside the same transaction that creates it.
//
// Not a migration and not a retrofit: every query in this API already scopes by
// the restaurant_id on the caller's staff_members row, so a second café is just
// two more rows. What this endpoint has to get right is that they are created
// together — a restaurant with no owner is a café nobody can open, and an owner
// row pointing at nothing is a login that 403s forever.

// Six to a row, matching the layout migration's own backfill, so a room of ten
// reads as two rows rather than one long line. The plan is 12x8 (see
// FloorPlanCanvas), which is why the count is capped where it is.
const TABLES_PER_ROW = 6;

export async function createRestaurant(db, user, { name, currency_code, table_count, display_name }) {
  return db.withTransaction(async (tx) => {
    // Already linked? Creating a second café here would leave them owning one
    // they can never reach, because staff_members.user_id is the primary key —
    // one person, one café. Checked in the transaction rather than before it,
    // so two taps on a slow connection can't both pass.
    const { rows: existing } = await tx.query(
      `select r.name from public.staff_members sm
         join public.restaurants r on r.id = sm.restaurant_id
        where sm.user_id = $1
        for update of sm`,
      [user.id],
    );
    if (existing.length) {
      throw new HttpError(409, 'already_linked', `This login already belongs to ${existing[0].name}.`);
    }

    const { rows: created } = await tx.query(
      `insert into public.restaurants (name, currency_code) values ($1, $2)
       returning id, name, currency_code`,
      [name, currency_code],
    );
    const restaurant = created[0];

    // The first person through the door is the owner; there is nobody else to
    // make one, and the last-owner guard then keeps it that way. The row is
    // read back rather than assumed, so the caller is told what was actually
    // written — the response cannot claim a role the database doesn't hold.
    const { rows: staff } = await tx.query(
      `insert into public.staff_members (user_id, restaurant_id, role, display_name)
       values ($1, $2, 'owner', $3)
       returning role, display_name`,
      [user.id, restaurant.id, display_name ?? null],
    );

    // The tables they said they have, laid out on the plan. Arranging a room
    // that is already there is a better first open than an empty grid and a
    // button — the same reasoning the layout migration used when it placed
    // every existing table rather than leaving them unplaced.
    if (table_count > 0) {
      await tx.query(
        `insert into public.restaurant_tables (restaurant_id, label, pos_x, pos_y)
         select $1, 'T' || n, (n - 1) % $3, (n - 1) / $3
           from generate_series(1, $2) as n`,
        [restaurant.id, table_count, TABLES_PER_ROW],
      );
    }

    // A starter menu (categories + sample dishes), so the first open isn't three
    // empty screens. Same transaction: a café is never half-seeded.
    await insertStarterMenu(tx, restaurant.id);

    return {
      userId: user.id,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      role: staff[0].role,
      displayName: staff[0].display_name,
    };
  }, { actorId: user.id });
}
