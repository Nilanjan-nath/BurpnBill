import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// GET/POST /tables — on real Postgres (PGlite) with the repo's migrations
// and seed (4 tables already exist: T1-T4).

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CAFE_OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db;
let server;
let base;
let otherRestaurantId;

before(async () => {
  db = await createTestDb();
  const supabase = {
    auth: {
      async getUser(token) {
        return token.startsWith('valid-')
          ? { data: { user: { id: token.slice(6) } }, error: null }
          : { data: null, error: new Error('bad token') };
      },
    },
  };
  const app = createApp({ config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 }, db, supabase });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;

  const { rows } = await db.query(`insert into restaurants (name) values ('Other Cafe') returning id`);
  otherRestaurantId = rows[0].id;
  await db.query(`insert into restaurant_tables (restaurant_id, label) values ($1, 'X1')`, [otherRestaurantId]);

  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $3, 'owner', 'Mita'), ($2, $3, 'staff', 'Ravi'), ($4, $5, 'owner', 'Rival')`,
    [OWNER, STAFF, RESTAURANT_ID, OTHER_CAFE_OWNER, otherRestaurantId],
  );
});

after(async () => {
  server.close();
  await db.close();
});

async function call(method, path, { as, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as && { Authorization: `Bearer valid-${as}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const listTables = (as) => call('GET', '/api/tables', { as });

test('needs a signed-in staff member; a café only ever sees its own tables', async () => {
  assert.equal((await call('GET', '/api/tables')).status, 401);
  const ours = (await listTables(STAFF)).body.tables;
  const theirs = (await listTables(OTHER_CAFE_OWNER)).body.tables;
  assert.deepEqual(ours.map((t) => t.label).sort(), ['T1', 'T2', 'T3', 'T4']);
  assert.deepEqual(theirs.map((t) => t.label), ['X1']);
});

test('each table has an opaque qr_token, never the raw label exposed as the token', async () => {
  const tables = (await listTables(STAFF)).body.tables;
  for (const t of tables) {
    assert.match(t.qr_token, /^[0-9a-f]{32}$/i);
    assert.notEqual(t.qr_token, t.label);
  }
});

test('creating a table is owner only, and validates the input', async () => {
  assert.equal((await call('POST', '/api/tables', { as: STAFF, body: { label: 'T9' } })).status, 403);

  for (const body of [{}, { label: '' }, { label: '  ' }, { label: 'x'.repeat(41) }, { label: 'T9', seats: 0 }, { label: 'T9', seats: -1 }, { label: 'T9', seats: 1.5 }]) {
    const res = await call('POST', '/api/tables', { as: OWNER, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('a created table gets its own real, working QR token', async () => {
  const res = await call('POST', '/api/tables', { as: OWNER, body: { label: 'T9', seats: 4 } });
  assert.equal(res.status, 201);
  assert.equal(res.body.table.label, 'T9');
  assert.equal(res.body.table.seats, 4);
  assert.equal(res.body.table.is_active, true);
  assert.match(res.body.table.qr_token, /^[0-9a-f]{32}$/i);

  const listed = (await listTables(OWNER)).body.tables;
  assert.ok(listed.some((t) => t.label === 'T9'));

  // The token is immediately real: it resolves to a live menu, same as any seeded table.
  const menu = await call('GET', `/api/menu/${res.body.table.qr_token}`);
  assert.equal(menu.status, 200);
  assert.equal(menu.body.table.label, 'T9');
});

test('seats is optional and nullable', async () => {
  const res = await call('POST', '/api/tables', { as: OWNER, body: { label: 'T10' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.table.seats, null);
});

test('a duplicate label within the same café is rejected; the same label at a different café is fine', async () => {
  const dup = await call('POST', '/api/tables', { as: OWNER, body: { label: 'T1' } });
  assert.equal(dup.status, 409);

  const sameLabelElsewhere = await call('POST', '/api/tables', { as: OTHER_CAFE_OWNER, body: { label: 'T1' } });
  assert.equal(sameLabelElsewhere.status, 201);
});

test('two tables never share a QR token, even across cafés', async () => {
  const a = (await call('POST', '/api/tables', { as: OWNER, body: { label: 'T11' } })).body.table;
  const b = (await call('POST', '/api/tables', { as: OTHER_CAFE_OWNER, body: { label: 'T11' } })).body.table;
  assert.notEqual(a.qr_token, b.qr_token);
});
