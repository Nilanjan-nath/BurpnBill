import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// Staff management (step 6 slice 5) on real Postgres (PGlite): three roles, and
// invites as pre-authorised emails rather than accounts.

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KITCHEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NEWCOMER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let db;
let server;
let base;
let otherRestaurantId;

// The fake Supabase client resolves a token to a user; unlike the other test
// files this one also carries an email, because claiming an invite depends on
// it. `valid-<id>` alone keeps working for users who need no email.
const emails = new Map();

// The invite email goes through Supabase Auth's admin API; record what the
// server asked for, and let a test make Supabase answer with an error.
let sentInvites = [];
let inviteError = null;

before(async () => {
  db = await createTestDb();
  const supabase = {
    auth: {
      async getUser(token) {
        if (!token.startsWith('valid-')) return { data: null, error: new Error('bad token') };
        const id = token.slice(6);
        return { data: { user: { id, email: emails.get(id) } }, error: null };
      },
      admin: {
        async inviteUserByEmail(email, options) {
          sentInvites.push({ email, options });
          return inviteError ? { data: null, error: inviteError } : { data: { user: { email } }, error: null };
        },
      },
    },
  };
  const app = createApp({ config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 }, db, supabase });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;

  const { rows } = await db.query(`insert into restaurants (name) values ('Other Cafe') returning id`);
  otherRestaurantId = rows[0].id;
});

after(async () => {
  server.close();
  await db.close();
});

beforeEach(async () => {
  emails.clear();
  sentInvites = [];
  inviteError = null;
  await db.query('delete from public.staff_invites');
  await db.query('delete from public.staff_members');
  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $4, 'owner', 'Mita'), ($2, $4, 'staff', 'Ravi'), ($3, $4, 'kitchen', 'Bikash')`,
    [OWNER, STAFF, KITCHEN, RESTAURANT_ID],
  );
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

const listStaff = (as) => call('GET', '/api/staff', { as });
const invite = (as, body) => call('POST', '/api/staff/invites', { as, body });

test('only the owner can see or change the team', async () => {
  assert.equal((await listStaff()).status, 401);
  assert.equal((await listStaff(STAFF)).status, 403);
  assert.equal((await listStaff(KITCHEN)).status, 403);

  const res = await listStaff(OWNER);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.members.map((m) => m.role).sort(), ['kitchen', 'owner', 'staff']);
  assert.equal(res.body.members[0].role, 'owner', 'the owner sorts first');

  assert.equal((await invite(STAFF, { email: 'x@example.com', role: 'kitchen' })).status, 403);
});

test('an invite is a pre-authorised email, claimed on the invitee\'s first request', async () => {
  const res = await invite(OWNER, { email: 'Priya@Example.com ', role: 'kitchen', display_name: 'Priya' });
  assert.equal(res.status, 201);
  assert.equal(res.body.invite.email, 'priya@example.com', 'stored lowercased, so matching is case-insensitive');

  assert.equal((await listStaff(OWNER)).body.invites.length, 1);

  // She signs up herself; Supabase is what verifies the address.
  emails.set(NEWCOMER, 'PRIYA@example.com');
  const me = await call('GET', '/api/me', { as: NEWCOMER });
  assert.equal(me.status, 200, 'her very first authenticated request links her');
  assert.equal(me.body.staff.role, 'kitchen');
  assert.equal(me.body.staff.displayName, 'Priya');

  const after2 = await listStaff(OWNER);
  assert.equal(after2.body.invites.length, 0, 'the invite is spent');
  assert.ok(after2.body.members.some((m) => m.user_id === NEWCOMER));

  // Single use: a second account claiming the same address finds nothing left.
  const impostor = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  emails.set(impostor, 'priya@example.com');
  assert.equal((await call('GET', '/api/me', { as: impostor })).status, 403, 'a spent invite is not a second key');
});

test('an unknown email, an expired invite, and another café\'s invite all stay locked out', async () => {
  emails.set(NEWCOMER, 'stranger@example.com');
  assert.equal((await call('GET', '/api/me', { as: NEWCOMER })).status, 403, 'no invite, no access');

  await invite(OWNER, { email: 'late@example.com', role: 'staff' });
  await db.query(`update public.staff_invites set expires_at = now() - interval '1 day'`);
  emails.set(NEWCOMER, 'late@example.com');
  assert.equal((await call('GET', '/api/me', { as: NEWCOMER })).status, 403, 'an expired invite is not a key');

  await db.query(
    `insert into public.staff_invites (restaurant_id, email, role) values ($1, 'theirs@example.com', 'staff')`,
    [otherRestaurantId],
  );
  emails.set(NEWCOMER, 'theirs@example.com');
  const me = await call('GET', '/api/me', { as: NEWCOMER });
  assert.equal(me.body.staff.restaurantId, otherRestaurantId, 'it links them to the café that invited them, not ours');
});

test('re-inviting the same address replaces the open invite instead of erroring', async () => {
  await invite(OWNER, { email: 'dev@example.com', role: 'kitchen' });
  const second = await invite(OWNER, { email: 'dev@example.com', role: 'staff' });

  assert.equal(second.status, 201);
  const { invites } = (await listStaff(OWNER)).body;
  assert.equal(invites.length, 1, 'still one open invite, not two');
  assert.equal(invites[0].role, 'staff', 'with the corrected role');
});

test('a revoked invite no longer opens the door', async () => {
  const created = await invite(OWNER, { email: 'nope@example.com', role: 'staff' });
  assert.equal((await call('DELETE', `/api/staff/invites/${created.body.invite.id}`, { as: OWNER })).status, 204);
  assert.equal((await listStaff(OWNER)).body.invites.length, 0);

  emails.set(NEWCOMER, 'nope@example.com');
  assert.equal((await call('GET', '/api/me', { as: NEWCOMER })).status, 403);
});

test('inviting emails the invitee a link to /staff, naming the café and the role', async () => {
  const res = await invite(OWNER, { email: 'New.Hire@Example.com', role: 'kitchen' });
  assert.equal(res.status, 201);
  assert.equal(res.body.email, 'sent');
  assert.equal(sentInvites.length, 1);
  assert.equal(sentInvites[0].email, 'new.hire@example.com');
  assert.equal(sentInvites[0].options.redirectTo, 'http://localhost:5173/staff', 'the link lands on the dashboard, not the home page');
  assert.deepEqual(sentInvites[0].options.data, { invited: true, restaurant_name: 'Chai Point Cafe', role: 'kitchen' });
});

test('an address that already has a login still gets the invite; it just is not emailed', async () => {
  inviteError = { code: 'email_exists', message: 'A user with this email address has already been registered' };
  const res = await invite(OWNER, { email: 'already@example.com', role: 'staff' });
  assert.equal(res.status, 201);
  assert.equal(res.body.email, 'has_account');
  assert.equal((await listStaff(OWNER)).body.invites.length, 1, 'the invite is what links them when they sign in');
  emails.set(NEWCOMER, 'already@example.com');
  assert.equal((await call('GET', '/api/me', { as: NEWCOMER })).status, 200, 'and signing in is enough to join');
});

test('an email that cannot be sent never loses the invite, and says so', async () => {
  inviteError = { message: 'SMTP connection refused' };
  const realError = console.error;
  console.error = () => {};
  try {
    const res = await invite(OWNER, { email: 'unlucky@example.com', role: 'staff' });
    assert.equal(res.status, 201, 'the owner\'s click still worked');
    assert.equal(res.body.email, 'failed');
    assert.equal((await listStaff(OWNER)).body.invites.length, 1);
  } finally {
    console.error = realError;
  }
});

test('resend sends the same email again and renews an expired invite', async () => {
  const created = await invite(OWNER, { email: 'again@example.com', role: 'kitchen' });
  await db.query(`update public.staff_invites set expires_at = now() - interval '1 day'`);
  sentInvites = [];

  const res = await call('POST', `/api/staff/invites/${created.body.invite.id}/resend`, { as: OWNER });
  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'sent');
  assert.equal(sentInvites.length, 1);
  assert.equal(sentInvites[0].email, 'again@example.com');
  assert.equal(sentInvites[0].options.data.role, 'kitchen');
  assert.equal((await listStaff(OWNER)).body.invites[0].expired, false, 'a resend gives it a fresh week');
});

test('resend is owner only, scoped to your café, and refuses a spent invite', async () => {
  const created = await invite(OWNER, { email: 'scoped@example.com', role: 'staff' });
  const url = `/api/staff/invites/${created.body.invite.id}/resend`;
  assert.equal((await call('POST', url, { as: STAFF })).status, 403);
  assert.equal((await call('POST', url, { as: KITCHEN })).status, 403);

  const { rows } = await db.query(
    `insert into public.staff_invites (restaurant_id, email, role) values ($1, 'theirs2@example.com', 'staff') returning id`,
    [otherRestaurantId],
  );
  assert.equal((await call('POST', `/api/staff/invites/${rows[0].id}/resend`, { as: OWNER })).status, 404, 'not your café\'s invite');

  await db.query(`update public.staff_invites set accepted_at = now() where id = $1`, [created.body.invite.id]);
  assert.equal((await call('POST', url, { as: OWNER })).status, 404, 'already claimed');
  assert.equal(sentInvites.length, 1, 'only the first invite ever sent mail');
});

test('validates the invite: a real email and one of the three roles', async () => {
  for (const body of [
    {},
    { email: 'not-an-email', role: 'staff' },
    { email: 'a@b.com' },
    { email: 'a@b.com', role: 'cashier' },
    { email: 'a@b.com', role: 'staff', extra: true },
  ]) {
    assert.equal((await invite(OWNER, body)).status, 400, JSON.stringify(body));
  }
});

test('roles can be changed, and removing someone unlinks them without touching their login', async () => {
  const promoted = await call('PATCH', `/api/staff/${KITCHEN}`, { as: OWNER, body: { role: 'staff' } });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.member.role, 'staff');

  assert.equal((await call('DELETE', `/api/staff/${STAFF}`, { as: OWNER })).status, 204);
  const { members } = (await listStaff(OWNER)).body;
  assert.ok(!members.some((m) => m.user_id === STAFF));

  assert.equal((await call('PATCH', `/api/staff/${STAFF}`, { as: OWNER, body: { role: 'staff' } })).status, 404);
  assert.equal((await call('DELETE', '/api/staff/99999999-9999-4999-8999-999999999999', { as: OWNER })).status, 404);
});

test('the last owner cannot demote or remove themselves — that would lock the café', async () => {
  const demote = await call('PATCH', `/api/staff/${OWNER}`, { as: OWNER, body: { role: 'staff' } });
  assert.equal(demote.status, 400);
  assert.match(demote.body.error.message, /only owner/i);
  assert.equal((await call('DELETE', `/api/staff/${OWNER}`, { as: OWNER })).status, 400);

  // With a second owner in place, both are allowed again.
  await call('PATCH', `/api/staff/${STAFF}`, { as: OWNER, body: { role: 'owner' } });
  assert.equal((await call('PATCH', `/api/staff/${OWNER}`, { as: OWNER, body: { role: 'staff' } })).status, 200);

  const { members } = (await listStaff(STAFF)).body;
  assert.equal(members.filter((m) => m.role === 'owner').length, 1);
});

test('another café\'s staff member is invisible and untouchable', async () => {
  const theirOwner = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values ($1, $2, 'owner', 'Rival')`,
    [theirOwner, otherRestaurantId],
  );

  assert.ok(!(await listStaff(OWNER)).body.members.some((m) => m.user_id === theirOwner));
  assert.equal((await call('PATCH', `/api/staff/${theirOwner}`, { as: OWNER, body: { role: 'kitchen' } })).status, 404);
  assert.equal((await call('DELETE', `/api/staff/${theirOwner}`, { as: OWNER })).status, 404);
});
