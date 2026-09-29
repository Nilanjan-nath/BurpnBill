import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// POST /restaurants — someone with a Supabase account and no café creates one
// and becomes its owner (step 7). Real Postgres (PGlite) with the repo's own
// migrations and seed; only Supabase Auth is faked.
//
// The thing under test is really multi-tenancy: a café made this way has to be
// a genuinely separate café, not a second name on the demo one's data.

const DEMO_OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEWCOMER = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
const SECOND_NEWCOMER = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
const THIRD_NEWCOMER = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';

let db;
let server;
let base;

before(async () => {
  db = await createTestDb();
  const supabase = {
    auth: {
      async getUser(token) {
        // A real verified user carries an email, and the route reads the
        // display-name fallback off it — so the fake has to as well.
        return token.startsWith('valid-')
          ? { data: { user: { id: token.slice(6), email: `${token.slice(6)}@example.com` } }, error: null }
          : { data: null, error: new Error('bad token') };
      },
    },
  };
  const app = createApp({ config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 }, db, supabase });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;

  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values ($1, $2, 'owner', 'Mita')`,
    [DEMO_OWNER, RESTAURANT_ID],
  );
});

after(async () => {
  server.close();
  await db.close();
});

async function call(method, path, { as, authorization, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as && { Authorization: `Bearer valid-${as}` }),
      ...(authorization && { Authorization: authorization }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const signUp = (as, body) => call('POST', '/api/restaurants', { as, body });

test('creating a café needs a verified account, but not a café', async () => {
  assert.equal((await call('POST', '/api/restaurants', { body: { name: 'X' } })).status, 401);
  assert.equal((await call('POST', '/api/restaurants', { authorization: 'Bearer junk', body: { name: 'X' } })).status, 401);
});

test('one request creates the café, its owner and its tables — and the owner can use the API at once', async () => {
  const res = await signUp(NEWCOMER, { name: 'Tripura Tea House', table_count: 8, display_name: 'Rupa' });
  assert.equal(res.status, 201);
  assert.equal(res.body.staff.role, 'owner');
  assert.equal(res.body.staff.restaurantName, 'Tripura Tea House');
  assert.equal(res.body.staff.displayName, 'Rupa');

  // The proof is not the response, it's that the ordinary staff API now works
  // for them — which is the whole point of creating both rows together.
  const me = await call('GET', '/api/me', { as: NEWCOMER });
  assert.equal(me.status, 200);
  assert.equal(me.body.staff.restaurantId, res.body.staff.restaurantId);
  assert.equal(me.body.staff.restaurantName, 'Tripura Tea House');

  // Owner is a role they really hold, not one the response claims: an
  // owner-only route is the proof, since requireOwner reads the row.
  assert.equal((await call('GET', '/api/staff', { as: NEWCOMER })).status, 200);
  const { rows: role } = await db.query('select role from staff_members where user_id = $1', [NEWCOMER]);
  assert.equal(role[0].role, 'owner');

  const tables = await call('GET', '/api/tables', { as: NEWCOMER });
  assert.equal(tables.body.tables.length, 8);
  assert.deepEqual(
    tables.body.tables.map((t) => t.label),
    ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'],
  );
  // Six to a row, matching the layout migration's own backfill: the first open
  // of the seating plan is a room to arrange, not an empty grid.
  assert.deepEqual(
    tables.body.tables.map((t) => [t.pos_x, t.pos_y]),
    [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [0, 1], [1, 1]],
  );
  // And they are real tables: the QR code on one resolves to that café's menu.
  const menu = await call('GET', `/api/menu/${tables.body.tables[0].qr_token}`);
  assert.equal(menu.status, 200);
  assert.equal(menu.body.restaurant.name, 'Tripura Tea House');
});

test('the new café is genuinely its own — it cannot see the demo café, or be seen by it', async () => {
  const mine = await call('GET', '/api/tables', { as: NEWCOMER });
  const theirs = await call('GET', '/api/tables', { as: DEMO_OWNER });
  const overlap = mine.body.tables.filter((t) => theirs.body.tables.some((o) => o.id === t.id));
  assert.deepEqual(overlap, [], 'two cafés, no shared tables');

  // A brand new café has no menu of its own, and certainly not the demo's.
  const items = await call('GET', '/api/items', { as: NEWCOMER });
  assert.deepEqual(items.body.items, [], "an empty menu is the new café's real state");
  assert.ok((await call('GET', '/api/items', { as: DEMO_OWNER })).body.items.length > 0);
});

test('a café with no tables yet is a real answer, not an error', async () => {
  const res = await signUp(SECOND_NEWCOMER, { name: 'Counter Only' });
  assert.equal(res.status, 201);
  assert.deepEqual((await call('GET', '/api/tables', { as: SECOND_NEWCOMER })).body.tables, []);
});

test('a second café from the same login is refused, and leaves nothing behind', async () => {
  const before = (await db.query('select count(*)::int as n from restaurants')).rows[0].n;

  const res = await signUp(NEWCOMER, { name: 'Tripura Tea House 2' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'already_linked');
  assert.match(res.body.error.message, /Tripura Tea House/, 'says which café they already belong to');

  const after = (await db.query('select count(*)::int as n from restaurants')).rows[0].n;
  assert.equal(after, before, 'no half-created café left over');
});

test('your own name falls back to the email, so nobody lands on the team list as nothing', async () => {
  const res = await signUp(THIRD_NEWCOMER, { name: 'Fallback Cafe' });
  assert.equal(res.body.staff.displayName, `${THIRD_NEWCOMER}@example.com`.split('@')[0]);
  const { rows } = await db.query('select display_name from staff_members where user_id = $1', [THIRD_NEWCOMER]);
  assert.equal(rows[0].display_name, `${THIRD_NEWCOMER}@example.com`.split('@')[0]);
});

test('the currency is normalised, and a nonsense one is refused before anything is written', async () => {
  const UNUSED = 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4';
  const bad = await signUp(UNUSED, { name: 'Bad Currency', currency_code: 'rupees' });
  assert.equal(bad.status, 400);
  assert.equal((await db.query('select count(*)::int as n from restaurants where name = $1', ['Bad Currency'])).rows[0].n, 0);

  const ok = await signUp(UNUSED, { name: 'Lower Case Cafe', currency_code: 'aed' });
  assert.equal(ok.status, 201);
  const { rows } = await db.query('select currency_code from restaurants where id = $1', [ok.body.staff.restaurantId]);
  assert.equal(rows[0].currency_code, 'AED');
});

test('a café needs a name, and cannot claim more tables than the plan holds', async () => {
  const UNUSED = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5';
  for (const body of [{ name: '' }, { name: '   ' }, {}, { name: 'X', table_count: 49 }, { name: 'X', table_count: -1 }]) {
    const res = await signUp(UNUSED, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'bad_request');
  }
  // The cap is a real edge, not an off-by-one: 48 is the plan's last row.
  assert.equal((await signUp(UNUSED, { name: 'Full House', table_count: 48 })).status, 201);
});
