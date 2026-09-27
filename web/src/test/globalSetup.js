import { createServer } from 'node:http';
import { createApp } from '../../../server/src/app.js';
import { createTestDb, RESTAURANT_ID } from '../../../server/test/helpers/testDb.js';

// Starts the REAL Express API (from ../server) on a real Postgres (PGlite with
// the repo's migrations + seed) once for the whole run, so the UI tests
// exercise the actual contract rather than a hand-written fake of it.
//
// It runs in plain Node, outside the jsdom test environment, and hands the
// tests its address via `inject('apiBase')`. A test-only endpoint,
// POST /__test/sql, lets a test change the database the way staff or time
// would (86 an item, expire a session) and read it back.

const STAFF_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECOND_STAFF_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
// Three roles since step 6 slice 5: 'staff' is front of house (and reaches
// POS), 'kitchen' is the board and 86'ing only.
const KITCHEN_USER_ID = 'a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9';

export default async function setup({ provide }) {
  const db = await createTestDb();

  // A fake Supabase Auth verifier — same convention as the server's own test
  // suite: a token is just "valid-<user id>". The staff dashboard tests
  // (staff/StaffApp.test.jsx) inject a matching fake Supabase CLIENT on the
  // browser side, so neither side ever makes a real network call to
  // Supabase; the one thing tying the two fakes together is this format.
  const supabase = {
    auth: {
      // "valid-<id>" as before, optionally "valid-<id>|<email>" — claiming a
      // staff invite matches on the email Supabase reports for the signed-in
      // user, so a test covering that path needs a way to supply one.
      async getUser(token) {
        if (!token.startsWith('valid-')) return { data: null, error: new Error('bad token') };
        const [id, email] = token.slice(6).split('|');
        return { data: { user: { id, ...(email && { email }) } }, error: null };
      },
    },
  };

  // Item photos: a stand-in for Supabase Storage, for the same reason the auth
  // client above is faked — the point of these tests is the dashboard against
  // the real API, not a round trip to Supabase. It hands back a URL shaped
  // exactly like the real bucket's, so what lands in `image_url` (and in an
  // <img src>) is what production would put there.
  let uploadCount = 0;
  const imageStore = {
    async upload({ restaurantId, itemId, contentType }) {
      const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
      return `https://storage.test/storage/v1/object/public/menu-images/${restaurantId}/${itemId}-${++uploadCount}.${ext}`;
    },
    async remove() {
      return true;
    },
  };

  const api = createApp({
    config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 },
    db,
    supabase,
    imageStore,
  });

  // Two staff logins already linked to the demo café — the dashboard tests
  // sign in as the first, and use the second where a test needs to show a
  // move made by a DIFFERENT staff member (e.g. the order-detail timeline).
  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $3, 'owner', 'Mita'), ($2, $3, 'staff', 'Ravi'), ($4, $3, 'kitchen', 'Bikash')`,
    [STAFF_USER_ID, SECOND_STAFF_USER_ID, RESTAURANT_ID, KITCHEN_USER_ID],
  );

  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/__test/sql') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try {
        const { text, params } = JSON.parse(raw);
        const { rows } = await db.query(text, params);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rows }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    api(req, res);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  provide('apiBase', `http://localhost:${server.address().port}`);
  provide('staffUserId', STAFF_USER_ID);
  provide('secondStaffUserId', SECOND_STAFF_USER_ID);
  provide('kitchenUserId', KITCHEN_USER_ID);

  return async () => {
    server.close();
    await db.close();
  };
}
