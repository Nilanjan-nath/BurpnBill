import { describe, test, expect, beforeAll, beforeEach, vi, inject } from 'vitest';
import { render, screen, within, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StaffApp from './StaffApp.jsx';

// The real staff dashboard -> the real Express API -> a real Postgres (see
// ../test/globalSetup.js, shared with the customer app's tests). Only the
// Supabase Auth CLIENT is faked (createFakeAuth, below) — its token still
// has to satisfy the server's own fake verifier there, so both sides agree
// on one convention: a token is "valid-<user id>".

const base = inject('apiBase');
const STAFF_USER = inject('staffUserId'); // 'Mita', owner
const KITCHEN_USER = inject('kitchenUserId'); // 'Bikash', kitchen
const SECOND_STAFF = inject('secondStaffUserId'); // 'Ravi', staff
const NOT_LINKED_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const realFetch = globalThis.fetch;
let fetchImpl;
let tokens;

async function sql(text, params = []) {
  const res = await realFetch(`${base}/__test/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body.rows;
}

beforeAll(async () => {
  vi.stubGlobal('fetch', (input, init) => fetchImpl(input, init));
  tokens = Object.fromEntries((await sql('select label, qr_token from restaurant_tables')).map((r) => [r.label, r.qr_token]));
});

beforeEach(() => {
  fetchImpl = (input, init) => realFetch(new URL(input, base), init);
});

async function api(method, path, { session, body } = {}) {
  const res = await realFetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session && { 'X-Guest-Session': session }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Places a real order through the real customer API, so the board has
// something genuine to show — not a hand-built fixture.
async function place(table, itemName, note) {
  const menu = (await api('GET', `/api/menu/${tokens[table]}`)).body;
  const session = menu.session.id;
  const item = menu.categories.flatMap((c) => c.items).find((i) => i.name === itemName);
  await api('POST', '/api/cart/items', { session, body: { menu_item_id: item.id, quantity: 1, special_instructions: note } });
  const cart = (await api('GET', '/api/cart', { session })).body;
  const res = await api('POST', '/api/orders', { session, body: { cart_id: cart.cart_id } });
  // A QR order now waits in POS's approval queue before the kitchen sees it.
  // Board/Recent tests are about the board, so approve out-of-band and keep
  // this helper meaning "an order the kitchen can see". The queue's own
  // behaviour has its own tests below.
  await sql('update orders set approved_at = now() where id = $1', [res.body.order.id]);
  return res.body.order;
}

// The same order, left waiting in the approval queue.
async function placeUnapproved(table, itemName, note) {
  const order = await place(table, itemName, note);
  await sql('update orders set approved_at = null where id = $1', [order.id]);
  return order;
}

// A fake Supabase Auth client: same shape as the real supabase-js client
// (see useStaffSession.js), no network. On success it produces a token the
// server's fake verifier (../test/globalSetup.js) will accept.
// `signUpAs` mirrors the real client closely enough to matter: Supabase
// returns a session from signUp only when "Confirm email" is OFF. Pass
// { requiresConfirmation: true } to get the other case, where the account
// exists but there is no session until they click the emailed link.
// Anything the dashboard hands Supabase's own client rather than our API —
// today just the new password, which deliberately never touches the server.
let passwordChanges = [];
beforeEach(() => {
  passwordChanges = [];
});

function createFakeAuth(userId, { signUpAs, requiresConfirmation = false } = {}) {
  let session = null;
  const listeners = new Set();
  return {
    auth: {
      async signUp({ email }) {
        if (email === 'taken@example.com') {
          return { data: {}, error: { message: 'User already registered' } };
        }
        if (requiresConfirmation) return { data: { user: { id: signUpAs }, session: null }, error: null };
        session = { access_token: `valid-${signUpAs}|${email}` };
        listeners.forEach((fn) => fn('SIGNED_IN', session));
        return { data: { session }, error: null };
      },
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(cb) {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }) {
        if (email !== 'owner@example.com' || password !== 'secret') {
          return { data: {}, error: { message: 'Invalid login credentials' } };
        }
        session = { access_token: `valid-${userId}`, user: { id: userId, email } };
        listeners.forEach((fn) => fn('SIGNED_IN', session));
        return { data: { session }, error: null };
      },
      async signOut() {
        session = null;
        listeners.forEach((fn) => fn('SIGNED_OUT', null));
        return { error: null };
      },
      async updateUser({ password }) {
        if (password === 'password') return { data: {}, error: { message: 'Password is too weak' } };
        passwordChanges.push(password);
        return { data: { user: { id: userId } }, error: null };
      },
    },
  };
}

async function signIn(browserUser, staffUserId, { email = 'owner@example.com', password = 'secret' } = {}) {
  render(<StaffApp auth={createFakeAuth(staffUserId)} />);
  await screen.findByRole('heading', { name: 'Staff sign in' });
  await browserUser.type(screen.getByLabelText('Email'), email);
  await browserUser.type(screen.getByLabelText('Password'), password);
  await browserUser.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in', () => {
  test('a wrong password shows an error and stays on the sign-in form', async () => {
    const user = userEvent.setup();
    render(<StaffApp auth={createFakeAuth(STAFF_USER)} />);

    await screen.findByRole('heading', { name: 'Staff sign in' });
    await user.type(screen.getByLabelText('Email'), 'owner@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
    expect(screen.getByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });

  test('a real login that isn\'t linked to any café is turned away, not shown a broken board', async () => {
    const user = userEvent.setup();
    await signIn(user, NOT_LINKED_USER);

    expect(await screen.findByText(/isn't linked to a café/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });

  test('a linked login reaches the board, and sign out returns to the sign-in form', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);

    expect(await screen.findByRole('heading', { name: 'Order board' })).toBeInTheDocument();
    // The sidebar names the CAFÉ you are signed in to (from GET /me), not the
    // person — who is signed in lives in Settings → User account.
    const sidebar = screen.getByRole('navigation', { name: 'View' });
    expect(within(sidebar).getByText('Chai Point Cafe')).toBeInTheDocument();
    expect(within(sidebar).queryByText('Mita')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
  });
});

describe('the board', () => {
  test('shows real orders in their column, with table, items and notes', async () => {
    const user = userEvent.setup();
    const order = await place('T1', 'Masala Chai', 'less sugar');
    await signIn(user, STAFF_USER);

    const newColumn = (await screen.findByRole('region', { name: 'New' }));
    const card = within(newColumn).getByText(`#${order.order_number}`).closest('article');
    expect(within(card).getByText('Table T1')).toBeInTheDocument();
    expect(within(card).getByText(/Masala Chai/)).toBeInTheDocument();
    expect(within(card).getByText(/less sugar/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Start preparing' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  test('moving an order updates its column immediately, with only the one legal next step shown', async () => {
    const user = userEvent.setup();
    const order = await place('T2', 'Filter Coffee');
    await signIn(user, STAFF_USER);

    const newColumn = await screen.findByRole('region', { name: 'New' });
    const card = () => within(newColumn).queryByText(`#${order.order_number}`)?.closest('article')
      ?? within(screen.getByRole('region', { name: 'Preparing' })).queryByText(`#${order.order_number}`)?.closest('article');

    await user.click(within(card()).getByRole('button', { name: 'Start preparing' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Preparing' })).getByText(`#${order.order_number}`)).toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'New' })).queryByText(`#${order.order_number}`)).not.toBeInTheDocument();

    // The card can move columns (via the live push) a moment before this
    // click's own request clears its busy flag — both are correct, just not
    // perfectly ordered, so wait rather than assert the instant it moves.
    const movedCard = within(screen.getByRole('region', { name: 'Preparing' })).getByText(`#${order.order_number}`).closest('article');
    await waitFor(() => expect(within(movedCard).getByRole('button', { name: 'Mark ready' })).toBeInTheDocument());
    expect(within(movedCard).queryByRole('button', { name: 'Start preparing' })).not.toBeInTheDocument();
  });

  test('cancelling asks for confirmation inline, and "Keep order" leaves it untouched', async () => {
    const user = userEvent.setup();
    const order = await place('T3', 'Masala Chai');
    await signIn(user, STAFF_USER);

    const newColumn = await screen.findByRole('region', { name: 'New' });
    const card = within(newColumn).getByText(`#${order.order_number}`).closest('article');

    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(within(card).getByText('Cancel this order?')).toBeInTheDocument();
    // Backing out shows the ordinary buttons again — no request sent, order untouched.
    await user.click(within(card).getByRole('button', { name: 'Keep order' }));
    expect(within(card).queryByText('Cancel this order?')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'New' })).getByText(`#${order.order_number}`)).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    await user.click(within(card).getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'New' })).queryByText(`#${order.order_number}`)).not.toBeInTheDocument());
  });

  test('a move that lost the race to another device shows who got there first, then resyncs', async () => {
    const user = userEvent.setup();
    const order = await place('T4', 'Masala Chai');
    await signIn(user, STAFF_USER);

    const newColumn = await screen.findByRole('region', { name: 'New' });
    const card = within(newColumn).getByText(`#${order.order_number}`).closest('article');

    // Moved out-of-band, bypassing the API entirely — on purpose, so no SSE
    // event fires for it. This dashboard is now genuinely, indefinitely
    // stale about this order (not just "stale for the next few ms until the
    // live push catches up", which the real API path would be — and isn't
    // something a UI test can reliably win a race against on a fast local
    // server; see the live-push test above for that path instead).
    await sql('update orders set status = $1 where id = $2', ['preparing', order.id]);

    await user.click(within(card).getByRole('button', { name: 'Start preparing' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/is already "preparing"/);
    // And the board resyncs: the order now correctly shows under Preparing.
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Preparing' })).getByText(`#${order.order_number}`)).toBeInTheDocument());
  });

  test('another device\'s move appears on this dashboard live, with no action taken here', async () => {
    const order = await place('T2', 'Masala Chai');
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);

    await screen.findByText(`#${order.order_number}`); // the board has loaded it as "placed"
    await screen.findByText('Live'); // the stream is actually connected before we act

    const res = await realFetch(`${base}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer valid-${STAFF_USER}` },
      body: JSON.stringify({ status: 'preparing' }),
    });
    expect(res.status).toBe(200);

    // Nobody clicked anything on THIS dashboard — the card just moves.
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Preparing' })).getByText(`#${order.order_number}`)).toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'New' })).queryByText(`#${order.order_number}`)).not.toBeInTheDocument();
  });
});

describe('going live', () => {
  test('a new order arriving live chimes the tab title with a count, which clears on focus', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);
    await screen.findByText('Live');
    document.title = 'Petuk staff — Order board';

    // A QR order reaches the kitchen only when staff accept it, so THAT is what
    // pushes order_created live — place it in the queue, then approve through
    // the real API so the server publishes exactly as it would in service.
    const order = await placeUnapproved('T3', 'Masala Chai');
    await approveViaApi(order.id);
    await screen.findByText(`#${order.order_number}`);

    await waitFor(() => expect(document.title).toMatch(/^\(1\) New order/));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(document.title).toBe('Petuk staff — Order board'));
  });

  test('"Turn on sound" arms it, without replaying for orders already on the board', async () => {
    const user = userEvent.setup();
    await place('T4', 'Masala Chai'); // already on the board before sound is armed — must not chime retroactively
    await signIn(user, STAFF_USER);

    const soundButton = await screen.findByRole('button', { name: 'Turn on sound' });
    await user.click(soundButton);
    expect(screen.queryByRole('button', { name: 'Turn on sound' })).not.toBeInTheDocument();

    // A genuinely new order after arming still works end to end (no crash from the audio path).
    const order = await place('T4', 'Filter Coffee');
    await waitFor(() => expect(screen.getByText(`#${order.order_number}`)).toBeInTheDocument());
  });

  test('an order waiting a long time is highlighted, using the server\'s clock, not the age at page load', async () => {
    const user = userEvent.setup();
    const order = await place('T1', 'Masala Chai');
    await sql(`update order_status_events set created_at = now() - interval '12 minutes' where order_id = $1`, [order.id]);

    await signIn(user, STAFF_USER);
    const card = (await screen.findByText(`#${order.order_number}`)).closest('article');
    expect(card).toHaveAttribute('data-stuck', 'danger');
    expect(within(card).getByText('12m')).toBeInTheDocument();
  });

  test('a dropped stream recovers and resyncs on its own, with no action from the staff member', async () => {
    const user = userEvent.setup();
    let streamAttempts = 0;
    const wrap = fetchImpl;
    fetchImpl = (input, init) => {
      if (String(input).includes('/orders/stream')) {
        streamAttempts += 1;
        if (streamAttempts === 1) {
          // A connection that opens, then ends immediately — the same shape
          // a dropped Wi-Fi connection leaves useOrderStream to recover from.
          return Promise.resolve(
            new Response(new ReadableStream({ start: (c) => c.close() }), {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            }),
          );
        }
      }
      return wrap(input, init);
    };

    await signIn(user, STAFF_USER);
    // The first (broken) connection opens and ends almost instantly; placing
    // an order right here lands it in the ~1s backoff gap before the retry —
    // no connection is up to push it, so only the eventual reconnect's
    // resync can reveal it on the board.
    const order = await place('T3', 'Masala Chai');

    await waitFor(() => expect(streamAttempts).toBeGreaterThanOrEqual(2)); // it actually retried, not just stayed live by luck
    await screen.findByText('Live', {}, { timeout: 5000 });
    await waitFor(() => expect(screen.getByText(`#${order.order_number}`)).toBeInTheDocument());
  });
});

async function approveViaApi(orderId, as = STAFF_USER) {
  const res = await realFetch(`${base}/api/orders/${orderId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer valid-${as}` },
  });
  expect(res.status).toBe(200);
}

async function moveViaApi(orderId, status, as = STAFF_USER) {
  const res = await realFetch(`${base}/api/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer valid-${as}` },
    body: JSON.stringify({ status }),
  });
  expect(res.status).toBe(200);
}

// Settles a table at the counter, the same way POS's checkout dialog does.
async function checkoutViaApi(tableId, method, as = STAFF_USER) {
  const res = await realFetch(`${base}/api/tables/${tableId}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer valid-${as}` },
    body: JSON.stringify({ method, idempotency_key: `web-recent-${Date.now()}-${Math.random()}` }),
  });
  expect(res.status).toBe(200);
}

// The seeded tables are shared, and other tests here clear them in bulk (POS's
// merged-bill test cancels everything unpaid on T3, which a served order can't
// legally do). So these tests bring their own table and take it away again —
// a real delete, cascading its orders, since nothing else ever saw it.
let recentTableSeq = 0;
async function freshTable() {
  const label = `RC${recentTableSeq++}`;
  const [row] = await sql(
    `insert into restaurant_tables (restaurant_id, label, seats)
     select restaurant_id, $1, 4 from restaurant_tables where label = 'T1' limit 1
     returning id, qr_token`,
    [label],
  );
  tokens[label] = row.qr_token;
  return { id: row.id, label };
}
const removeTable = (id) => sql('delete from restaurant_tables where id = $1', [id]);

describe('order detail and Recent', () => {
  test('opening an order from the board shows its items, total and timeline', async () => {
    const user = userEvent.setup();
    const order = await place('T1', 'Masala Chai', 'less sugar');
    await signIn(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: `#${order.order_number}` }));
    const drawer = await screen.findByRole('dialog', { name: `Order #${order.order_number}` });

    // The drawer's own heading carries the current status, so assert there
    // rather than on a class — "placed" also appears down in the timeline.
    expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent('placed');
    expect(within(drawer).getByText('Table T1')).toBeInTheDocument();
    const itemLine = within(drawer).getByText(/Masala Chai/).closest('li');
    expect(within(itemLine).getByText(/less sugar/)).toBeInTheDocument();
    expect(within(itemLine).getByText('₹30.00')).toBeInTheDocument(); // one item, so its line total...
    expect(within(drawer).getByText('Total').nextSibling).toHaveTextContent('₹30.00'); // ...equals the order total

    const timeline = within(drawer).getByRole('list', { name: 'Status timeline' });
    expect(within(timeline).getByText('placed')).toBeInTheDocument();
    expect(within(timeline).getByText('—')).toBeInTheDocument(); // placed by the customer, no staff actor

    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('the Recent tab lists served/cancelled orders, and opening one shows who moved it through each step', async () => {
    const user = userEvent.setup();
    const served = await place('T2', 'Masala Chai');
    await moveViaApi(served.id, 'preparing'); // Mita
    await moveViaApi(served.id, 'ready', SECOND_STAFF); // Ravi
    await moveViaApi(served.id, 'served'); // Mita again
    const cancelled = await place('T2', 'Masala Chai');
    await moveViaApi(cancelled.id, 'cancelled');

    await signIn(user, STAFF_USER);
    await screen.findByRole('region', { name: 'New' }); // wait for the board to actually load, not still "Loading…"
    expect(screen.queryByText(`#${served.order_number}`)).not.toBeInTheDocument(); // not on the live board

    await user.click(await screen.findByRole('button', { name: 'Recent' }));
    const servedRow = await screen.findByRole('button', { name: new RegExp(`#${served.order_number}`) });
    expect(within(servedRow).getByText('served')).toBeInTheDocument();
    const cancelledRow = screen.getByRole('button', { name: new RegExp(`#${cancelled.order_number}`) });
    expect(within(cancelledRow).getByText('cancelled')).toBeInTheDocument();

    await user.click(servedRow);
    const drawer = await screen.findByRole('dialog', { name: `Order #${served.order_number}` });
    const timelineText = within(drawer).getByRole('list', { name: 'Status timeline' }).textContent;
    expect(timelineText).toMatch(/placed.*preparing.*ready.*served/s);
    expect(within(drawer).getByText('Ravi')).toBeInTheDocument(); // moved it to ready
    expect(within(drawer).getAllByText('Mita').length).toBe(2); // moved it to preparing, then served it
  });

  test('Recent has its own Refresh, independent of the live board', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'Recent' }));
    await screen.findByRole('heading', { name: 'Finished orders' });

    const order = await place('T4', 'Masala Chai');
    await moveViaApi(order.id, 'cancelled');
    expect(screen.queryByText(new RegExp(`#${order.order_number}`))).not.toBeInTheDocument(); // not live-updated

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('button', { name: new RegExp(`#${order.order_number}`) })).toBeInTheDocument();
  });

  test('a row says who finished it and how it was paid — and flags one that went out unpaid', async () => {
    const user = userEvent.setup();
    const table = await freshTable();
    try {
      const order = await place(table.label, 'Masala Chai');
      await moveViaApi(order.id, 'preparing');
      await moveViaApi(order.id, 'ready');
      await moveViaApi(order.id, 'served', SECOND_STAFF); // Ravi finished it, not the signed-in Mita

      await signIn(user, STAFF_USER);
      await user.click(await screen.findByRole('button', { name: 'Recent' }));

      const row = () => screen.findByRole('button', { name: new RegExp(`#${order.order_number}`) });
      expect(within(await row()).getByText('Ravi')).toBeInTheDocument();
      expect(within(await row()).getByText('Unpaid')).toBeInTheDocument();

      await checkoutViaApi(table.id, 'cash');
      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(async () => expect(within(await row()).getByText('Cash')).toBeInTheDocument());
      expect(within(await row()).queryByText('Unpaid')).not.toBeInTheDocument();
    } finally {
      await removeTable(table.id);
    }
  });

  test('Yesterday asks the server for a different day, rather than filtering what today already loaded', async () => {
    const user = userEvent.setup();
    const table = await freshTable();
    try {
      const order = await place(table.label, 'Masala Chai');
      await moveViaApi(order.id, 'cancelled'); // finished just now, so: today

      await signIn(user, STAFF_USER);
      await user.click(await screen.findByRole('button', { name: 'Recent' }));
      const number = new RegExp(`#${order.order_number}`);
      expect(await screen.findByRole('button', { name: number })).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Yesterday' }));
      // Wait for yesterday to have actually LOADED before asserting the row is
      // gone: the screen blanks to "Loading…" between days, so an absence
      // checked too early passes even if the day never reached the server.
      await screen.findByText(/Nothing served or cancelled yesterday yet/);
      expect(screen.queryByRole('button', { name: number })).not.toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'Today' }));
      expect(await screen.findByRole('button', { name: number })).toBeInTheDocument();
    } finally {
      await removeTable(table.id);
    }
  });

  test('the status filter and the search narrow the day without reloading it', async () => {
    const user = userEvent.setup();
    const table = await freshTable();
    try {
      const served = await place(table.label, 'Filter Coffee');
      await moveViaApi(served.id, 'preparing');
      await moveViaApi(served.id, 'ready');
      await moveViaApi(served.id, 'served');
      const cancelled = await place(table.label, 'Veg Sandwich');
      await moveViaApi(cancelled.id, 'cancelled');

      await signIn(user, STAFF_USER);
      await user.click(await screen.findByRole('button', { name: 'Recent' }));
      const servedRow = new RegExp(`#${served.order_number}`);
      const cancelledRow = new RegExp(`#${cancelled.order_number}`);
      expect(await screen.findByRole('button', { name: servedRow })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^Cancelled \(/ }));
      expect(screen.queryByRole('button', { name: servedRow })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: cancelledRow })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^All \(/ }));
      expect(screen.getByRole('button', { name: servedRow })).toBeInTheDocument();

      // Searching by dish, because "what had the coffee on it" is how someone
      // actually comes looking for a row they half-remember.
      await user.type(screen.getByRole('searchbox', { name: 'Search recent orders' }), 'Filter Coffee');
      expect(screen.getByRole('button', { name: servedRow })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: cancelledRow })).not.toBeInTheDocument();
    } finally {
      await removeTable(table.id);
    }
  });
});

describe('the Menu tab', () => {
  // STAFF_USER (Mita) is seeded as 'owner'; SECOND_STAFF (Ravi) as 'staff' —
  // see ../test/globalSetup.js. Named for the ORDER-board tests they were
  // first used in; kept here rather than renamed to avoid an unrelated diff.
  const openMenuTab = async (user, asUserId) => {
    await signIn(user, asUserId);
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
  };

  // Cards, not rows, since the redesign: the photo (or its monogram) is part
  // of the card, so the whole card is what a test reaches into.
  const cardFor = async (name) => (await screen.findByRole('heading', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).closest('div.group');

  test('owner sees New menu item and per-card Edit/Delete', async () => {
    const owner = userEvent.setup();
    await openMenuTab(owner, STAFF_USER);

    expect(await screen.findByRole('button', { name: /New menu item/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /New category/ })).toBeInTheDocument();
    const chai = await cardFor('Masala Chai');
    expect(within(chai).getByRole('button', { name: 'Edit Masala Chai' })).toBeInTheDocument();
    expect(within(chai).getByRole('button', { name: 'Delete Masala Chai' })).toBeInTheDocument();
    expect(within(chai).getByRole('checkbox')).toBeInTheDocument();
  });

  test('staff see the same list with only the availability toggle — no add/edit/delete', async () => {
    const staff = userEvent.setup();
    await openMenuTab(staff, SECOND_STAFF);

    // Wait for the menu to actually finish loading BEFORE checking anything
    // is absent — a "not present" check against a still-loading screen
    // (nothing rendered yet either way) would pass vacuously either way.
    const chai = await cardFor('Masala Chai');
    expect(screen.queryByRole('button', { name: /New menu item/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New category/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Categories/ })).not.toBeInTheDocument();
    expect(within(chai).queryByRole('button', { name: 'Edit Masala Chai' })).not.toBeInTheDocument();
    expect(within(chai).queryByRole('button', { name: 'Delete Masala Chai' })).not.toBeInTheDocument();
    expect(within(chai).getByRole('checkbox')).toBeInTheDocument();
  });

  test('staff can 86 an item from here, and it disappears from the real customer menu immediately', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, SECOND_STAFF);

    const card = await cardFor('Filter Coffee');
    const toggle = within(card).getByRole('checkbox');
    expect(toggle).toBeChecked();
    await user.click(toggle);
    try {
      await waitFor(() => expect(within(card).getByRole('checkbox')).not.toBeChecked());
      const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
      expect(menu.categories.flatMap((c) => c.items).some((i) => i.name === 'Filter Coffee')).toBe(false);
    } finally {
      // Everything above the restore, not just the API call: an assertion that
      // throws outside it leaves the item 86'd for every later test in the run.
      await sql("update menu_items set is_available = true where name = 'Filter Coffee'");
    }
  });

  test('search narrows to name or description, and says so when nothing matches', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);
    await cardFor('Masala Chai');

    const search = screen.getByRole('searchbox', { name: 'Search dishes' });
    await user.type(search, 'cardamom'); // only in Masala Chai's description
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Veg Sandwich' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /Masala Chai/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'zzzz');
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  test("owner can add an item into a category, and it's on the real customer menu right away", async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: /New menu item/ }));
    const form = await screen.findByRole('dialog', { name: 'Add menu item' });
    await user.type(within(form).getByLabelText('Item name'), 'Cold Kokum Sherbet');
    await user.type(within(form).getByLabelText(/Price/), '45');
    await user.selectOptions(within(form).getByLabelText('Category'), 'Beverages');
    await user.click(within(form).getByRole('radio', { name: 'Veg' }));
    await user.click(within(form).getByRole('button', { name: 'Create menu item' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const card = await cardFor('Cold Kokum Sherbet');
    expect(within(card).getByText('Beverages')).toBeInTheDocument();

    const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
    const beverages = menu.categories.find((c) => c.name === 'Beverages');
    expect(beverages.items.find((i) => i.name === 'Cold Kokum Sherbet')?.price).toBe('45.00');
  });

  test('an item with no category is filed under Uncategorised, not left blank', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: /New menu item/ }));
    const form = await screen.findByRole('dialog', { name: 'Add menu item' });
    await user.type(within(form).getByLabelText('Item name'), 'Loose Leaf');
    await user.type(within(form).getByLabelText(/Price/), '15');
    await user.click(within(form).getByRole('button', { name: 'Create menu item' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const card = await cardFor('Loose Leaf');
    expect(within(card).getByText('Uncategorised')).toBeInTheDocument();

    await sql("delete from menu_items where name = 'Loose Leaf'");
  });

  test('owner can edit an item — the whole form resubmits, values update everywhere', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    const card = await cardFor('Samosa (2 pcs)');
    await user.click(within(card).getByRole('button', { name: 'Edit Samosa (2 pcs)' }));
    const form = await screen.findByRole('dialog', { name: 'Edit Samosa (2 pcs)' });

    const priceInput = within(form).getByLabelText(/Price/);
    await user.clear(priceInput);
    await user.type(priceInput, '50');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(await cardFor('Samosa (2 pcs)')).getByText('₹50.00')).toBeInTheDocument();

    await sql("update menu_items set price = 40 where name = 'Samosa (2 pcs)'");
  });

  test('deleting uses an inline confirmation, not a native popup, and "Keep it" changes nothing', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: /New menu item/ }));
    const form = await screen.findByRole('dialog', { name: 'Add menu item' });
    await user.type(within(form).getByLabelText('Item name'), 'Test Special');
    await user.type(within(form).getByLabelText(/Price/), '99');
    await user.click(within(form).getByRole('button', { name: 'Create menu item' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    let card = await cardFor('Test Special');
    await user.click(within(card).getByRole('button', { name: 'Delete Test Special' }));
    expect(within(card).getByText('Delete Test Special?')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('heading', { name: 'Test Special' })).toBeInTheDocument();

    card = await cardFor('Test Special');
    await user.click(within(card).getByRole('button', { name: 'Delete Test Special' }));
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Test Special' })).not.toBeInTheDocument());

    const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
    expect(menu.categories.flatMap((c) => c.items).some((i) => i.name === 'Test Special')).toBe(false);
  });

  // --- photos ---------------------------------------------------------------

  test('a photo uploaded here is the photo a customer sees, and the card stops showing a monogram', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    // A card with no photo falls back to the item's two-letter monogram.
    let card = await cardFor('Cold Coffee');
    expect(within(card).getByText('CC')).toBeInTheDocument();
    // An <img> element specifically — the veg dot is a role="img" of its own,
    // because "is this vegetarian" has to be announced, not just seen.
    expect(card.querySelector('img')).toBeNull();

    await user.click(within(card).getByRole('button', { name: 'Edit Cold Coffee' }));
    const form = await screen.findByRole('dialog', { name: 'Edit Cold Coffee' });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'coffee.png', { type: 'image/png' });
    await user.upload(within(form).getByLabelText('Item photo'), file);
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    card = await cardFor('Cold Coffee');
    await waitFor(() => expect(within(card).queryByText('CC')).not.toBeInTheDocument());
    const img = within(card).getByRole('presentation');
    expect(img.getAttribute('src')).toContain('menu-images/');

    const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
    const onMenu = menu.categories.flatMap((c) => c.items).find((i) => i.name === 'Cold Coffee');
    expect(onMenu.image_url).toBe(img.getAttribute('src'));

    await sql("update menu_items set image_url = null where name = 'Cold Coffee'");
  });

  test('the monogram fallback skips counts and brackets in a dish name', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    // "Samosa (2 pcs)" — first letters of the first two words that actually
    // start with a letter, not of "(2".
    expect(within(await cardFor('Samosa (2 pcs)')).getByText('SP')).toBeInTheDocument();
    expect(within(await cardFor('Masala Chai')).getByText('MC')).toBeInTheDocument();
  });

  test('editing an item opens with its current category already chosen', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    const card = await cardFor('Masala Chai');
    await user.click(within(card).getByRole('button', { name: 'Edit Masala Chai' }));
    const form = await screen.findByRole('dialog', { name: 'Edit Masala Chai' });

    const select = within(form).getByLabelText('Category');
    expect(select.selectedOptions[0].textContent).toBe('Beverages');
  });

  test('a file that is not an image we render is refused in the dialog, before any upload', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    const card = await cardFor('Maggi Masala');
    await user.click(within(card).getByRole('button', { name: 'Edit Maggi Masala' }));
    const form = await screen.findByRole('dialog', { name: 'Edit Maggi Masala' });

    // Dropped, not picked: the file input's own `accept` already turns a PDF
    // away in the picker, so a drop is the path this guard actually exists for.
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'menu.pdf', { type: 'application/pdf' });
    fireEvent.drop(within(form).getByText('Click to add a photo'), { dataTransfer: { files: [pdf] } });

    expect(await within(form).findByText(/must be a PNG, JPG or WEBP/)).toBeInTheDocument();
    expect(form.querySelector('img')).toBeNull();
  });

  // --- categories -----------------------------------------------------------

  test('the Categories view lists them in menu order with a live item count', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);
    await user.click(await screen.findByRole('tab', { name: /Categories/ }));

    const rows = (await screen.findAllByText(/^(Beverages|Snacks|Mains|Desserts)$/)).map((el) => el.textContent);
    expect(rows).toEqual(['Beverages', 'Snacks', 'Mains', 'Desserts']);
    expect(screen.getByText('4 items')).toBeInTheDocument(); // Beverages
  });

  test('a new category can be created before anything is in it, and lands last on the menu', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: /New category/ }));
    const form = await screen.findByRole('dialog', { name: 'Add category' });
    await user.type(within(form).getByLabelText('Category name'), 'Chef specials');
    await user.click(within(form).getByRole('button', { name: 'Create category' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(await screen.findByRole('tab', { name: /Categories/ }));
    const empty = (await screen.findByText('Chef specials')).closest('div.flex');
    expect(within(empty).getByText('0 items')).toBeInTheDocument();

    // It is on the customer's menu picker only once something is in it —
    // an empty section is a thing the owner is mid-way through building.
    const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
    expect(menu.categories.some((c) => c.name === 'Chef specials')).toBe(false);

    await sql("delete from menu_categories where name = 'Chef specials'");
  });

  test('deleting a category moves its items to Uncategorised, and says so before it does', async () => {
    await sql("insert into menu_categories (restaurant_id, name, display_order) select id, 'Sides', 60 from restaurants where slug = 'chai-point'");
    await sql("update menu_items set category_id = (select id from menu_categories where name = 'Sides') where name = 'Chicken Puff'");

    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);
    await user.click(await screen.findByRole('tab', { name: /Categories/ }));

    const row = (await screen.findByText('Sides')).closest('div.flex');
    await user.click(within(row).getByRole('button', { name: 'Delete Sides' }));
    expect(within(row).getByText('Move 1 to Uncategorised?')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Sides')).not.toBeInTheDocument());

    // The food survived its section.
    await user.click(screen.getByRole('tab', { name: /Menu items/ }));
    const card = await cardFor('Chicken Puff');
    expect(within(card).getByText('Uncategorised')).toBeInTheDocument();

    await sql("update menu_items set category_id = (select id from menu_categories where name = 'Snacks') where name = 'Chicken Puff'");
  });

  test('renaming a category renames it everywhere, without touching the items', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);
    await user.click(await screen.findByRole('tab', { name: /Categories/ }));

    const row = (await screen.findByText('Desserts')).closest('div.flex');
    await user.click(within(row).getByRole('button', { name: 'Edit Desserts' }));
    const form = await screen.findByRole('dialog', { name: 'Edit Desserts' });
    await user.clear(within(form).getByLabelText('Category name'));
    await user.type(within(form).getByLabelText('Category name'), 'Sweets');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: /Menu items/ }));
    const card = await cardFor('Chocolate Brownie');
    expect(within(card).getByText('Sweets')).toBeInTheDocument();

    const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
    expect(menu.categories.some((c) => c.name === 'Sweets')).toBe(true);

    await sql("update menu_categories set name = 'Desserts' where name = 'Sweets'");
  });
});

describe('Settings', () => {
  // A table's name appears twice once the floor plan is up: on the plan and
  // in the list under it. Row lookups have to say which they mean.
  const listRow = async (label) =>
    within(await screen.findByRole('table')).getByText(label).closest('tr');

  const openSettings = async (user, asUserId, view) => {
    await signIn(user, asUserId);
    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    // A role with only one view gets no tab strip at all, so there is nothing
    // to click — it is already on the view it owns.
    const tab = view && screen.queryByRole('tab', { name: view });
    if (tab) await user.click(tab);
  };

  test('every role gets Settings, but only the owner gets the café half of it', async () => {
    const owner = userEvent.setup();
    await openSettings(owner, STAFF_USER);
    expect(await screen.findByRole('tab', { name: /Restaurant profile/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Seating plan/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /User account/ })).toBeInTheDocument();

    cleanup();
    const kitchen = userEvent.setup();
    await openSettings(kitchen, KITCHEN_USER);
    // Not a tab it can't reach — no tab strip at all, and it opens straight
    // onto the one view it does own.
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Restaurant profile/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Seating plan/ })).not.toBeInTheDocument();
  });

  // --- Restaurant profile ---------------------------------------------------

  test("the profile loads the café's real record, and saving reaches the customer menu", async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Restaurant profile/);

    const name = await screen.findByLabelText('Restaurant name');
    expect(name).toHaveValue('Chai Point Cafe');
    expect(screen.getByLabelText('Operational currency')).toHaveValue('INR');

    await user.type(screen.getByLabelText('Physical address'), 'north tripura, batarashi road');
    await user.type(screen.getByLabelText('Phone number'), '8787368753');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    const { body } = await api('GET', `/api/menu/${tokens.T1}`);
    expect(body.restaurant.name).toBe('Chai Point Cafe');

    const rows = await sql('select address, phone from restaurants where slug = $1', ['chai-point']);
    expect(rows[0]).toEqual({ address: 'north tripura, batarashi road', phone: '8787368753' });

    await sql('update restaurants set address = null, phone = null where slug = $1', ['chai-point']);
  });

  test('renaming the café renames it in the sidebar too, not just in the form', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Restaurant profile/);

    const sidebar = screen.getByRole('navigation', { name: 'View' });
    expect(within(sidebar).getByText('Chai Point Cafe')).toBeInTheDocument();

    try {
      const name = await screen.findByLabelText('Restaurant name');
      await user.clear(name);
      await user.type(name, 'Chai Point Roasters');
      await user.click(screen.getByRole('button', { name: 'Save profile' }));

      expect(await screen.findByText('Saved')).toBeInTheDocument();
      // Without this the sidebar keeps the name fetched at sign-in until
      // someone reloads, and the café appears to have two names at once.
      expect(await within(sidebar).findByText('Chai Point Roasters')).toBeInTheDocument();
      expect(within(sidebar).queryByText('Chai Point Cafe')).not.toBeInTheDocument();
    } finally {
      await sql("update restaurants set name = 'Chai Point Cafe' where slug = 'chai-point'");
    }
  });

  test('Save is only offered once something has actually changed', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Restaurant profile/);

    const save = await screen.findByRole('button', { name: 'Save profile' });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('Phone number'), '9');
    expect(save).toBeEnabled();
  });

  test('changing the currency changes what a customer is quoted in', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Restaurant profile/);

    await user.selectOptions(await screen.findByLabelText('Operational currency'), 'AED');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    const { body } = await api('GET', `/api/menu/${tokens.T1}`);
    expect(body.restaurant.currency_code).toBe('AED');

    await sql("update restaurants set currency_code = 'INR' where slug = 'chai-point'");
  });

  // --- Seating plan ---------------------------------------------------------

  test('the floor plan shows every table where the owner put it, coloured by what it is doing', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const plan = await screen.findByTestId('floor-plan');
    // Seeded as two rows of two (see supabase/seed.sql).
    expect(within(plan).getByRole('button', { name: /^T1, / })).toHaveStyle({ left: '0.0000%', top: '0.0000%' });
    expect(within(plan).getByRole('button', { name: /^T2, / })).toHaveStyle({ left: '8.3333%', top: '0.0000%' });
    expect(within(plan).getByRole('button', { name: /^T3, / })).toHaveStyle({ left: '0.0000%', top: '12.5000%' });

    // Only the three states this app can actually know.
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Occupied')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText('Dirty')).not.toBeInTheDocument();
    expect(screen.queryByText('Reserved')).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument();
  });

  test('a table with a live order shows as occupied on the plan', async () => {
    await place('T2', 'Masala Chai');
    try {
      const user = userEvent.setup();
      await openSettings(user, STAFF_USER, /Seating plan/);
      const plan = await screen.findByTestId('floor-plan');
      expect(within(plan).getByRole('button', { name: /^T2, Occupied/ })).toBeInTheDocument();
    } finally {
      await sql("update orders set paid_at = now() where table_id = (select id from restaurant_tables where label = 'T2')");
    }
  });

  test('a table can be moved with the keyboard, and the move is saved', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const plan = await screen.findByTestId('floor-plan');
    const t2 = within(plan).getByRole('button', { name: /^T2, / });
    t2.focus();
    await user.keyboard('{ArrowRight}'); // (1,0) -> (2,0), a free cell

    try {
      await waitFor(async () => {
        const rows = await sql("select pos_x, pos_y from restaurant_tables where label = 'T2'");
        expect(rows[0]).toEqual({ pos_x: 2, pos_y: 0 });
      });
      await waitFor(() =>
        expect(within(screen.getByTestId('floor-plan')).getByRole('button', { name: /^T2, / })).toHaveStyle({
          left: '16.6667%',
        }),
      );
    } finally {
      await sql("update restaurant_tables set pos_x = 1, pos_y = 0 where label = 'T2'");
    }
  });

  // jsdom does no layout, so the plan measures 0x0 and a pointer drag has
  // nothing to land on. Giving it a real rect is what makes dragging testable
  // at all — otherwise this whole path is eyeball-only. 12x8 cells of 100px.
  const measurePlan = (plan) => {
    plan.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => {},
    });
    return { cell: (x, y) => ({ clientX: x * 100 + 50, clientY: y * 100 + 50 }) };
  };

  test('dragging a table follows the cursor, previews where it lands, and saves it there', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const plan = await screen.findByTestId('floor-plan');
    const { cell } = measurePlan(plan);
    const t2 = within(plan).getByRole('button', { name: /^T2, / }); // (1,0)

    await user.pointer({ keys: '[MouseLeft>]', target: t2, coords: cell(1, 0) });
    await user.pointer({ target: t2, coords: cell(4, 2) });

    try {
      // Mid-drag: the card is lifted and following, and the target square is
      // showing where it would land.
      expect(within(plan).getByRole('button', { name: /^T2, / }).style.transform).toMatch(/translate\(300px, 200px\)/);
      const target = within(plan).getByTestId('drop-target');
      expect(target).toHaveStyle({ left: '33.3333%', top: '25.0000%' });
      expect(target).toHaveAttribute('data-blocked', 'false');
      expect(screen.getByRole('status')).toHaveTextContent('Drop in row 3, column 5');

      await user.pointer({ keys: '[/MouseLeft]', target: t2, coords: cell(4, 2) });

      await waitFor(async () => {
        const rows = await sql("select pos_x, pos_y from restaurant_tables where label = 'T2'");
        expect(rows[0]).toEqual({ pos_x: 4, pos_y: 2 });
      });
      // And the lift is over — no stray transform left behind.
      await waitFor(() => expect(within(screen.getByTestId('floor-plan')).getByRole('button', { name: /^T2, / }).style.transform).toBe(''));
    } finally {
      await sql("update restaurant_tables set pos_x = 1, pos_y = 0 where label = 'T2'");
    }
  });

  test('dragging onto an occupied square says so, and drops nothing', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const plan = await screen.findByTestId('floor-plan');
    const { cell } = measurePlan(plan);
    const t1 = within(plan).getByRole('button', { name: /^T1, / }); // (0,0)

    await user.pointer({ keys: '[MouseLeft>]', target: t1, coords: cell(0, 0) });
    await user.pointer({ target: t1, coords: cell(1, 0) }); // T2 lives here

    expect(within(plan).getByTestId('drop-target')).toHaveAttribute('data-blocked', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('That square is taken');

    await user.pointer({ keys: '[/MouseLeft]', target: t1, coords: cell(1, 0) });

    const rows = await sql("select pos_x, pos_y from restaurant_tables where label = 'T1'");
    expect(rows[0]).toEqual({ pos_x: 0, pos_y: 0 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('Escape abandons a drag and puts the table back', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const plan = await screen.findByTestId('floor-plan');
    const { cell } = measurePlan(plan);
    const t3 = within(plan).getByRole('button', { name: /^T3, / }); // (0,1)

    await user.pointer({ keys: '[MouseLeft>]', target: t3, coords: cell(0, 1) });
    await user.pointer({ target: t3, coords: cell(6, 4) });
    expect(within(plan).getByTestId('drop-target')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(within(plan).queryByTestId('drop-target')).not.toBeInTheDocument();

    // Releasing after a cancel must not land it either.
    await user.pointer({ keys: '[/MouseLeft]', target: t3, coords: cell(6, 4) });
    const rows = await sql("select pos_x, pos_y from restaurant_tables where label = 'T3'");
    expect(rows[0]).toEqual({ pos_x: 0, pos_y: 1 });
  });

  test('picking a table on the plan highlights its row, and picking the row highlights the table', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const plan = await screen.findByTestId('floor-plan');
    const card = within(plan).getByRole('button', { name: /^T4, / });
    expect(card).toHaveAttribute('aria-pressed', 'false');

    await user.click(card);
    expect(within(plan).getByRole('button', { name: /^T4, / })).toHaveAttribute('aria-pressed', 'true');
    expect(await listRow('T4')).toHaveClass('bg-teal-50');

    // And back the other way — the row's name finds it on the plan.
    await user.click(within(await listRow('T4')).getByRole('button', { name: 'Find T4 on the plan' }));
    expect(within(screen.getByTestId('floor-plan')).getByRole('button', { name: /^T4, / })).toHaveAttribute('aria-pressed', 'false');
  });

  test('a table cannot be moved onto one that is already there', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const plan = await screen.findByTestId('floor-plan');
    const t1 = within(plan).getByRole('button', { name: /^T1, / }); // (0,0)
    t1.focus();
    await user.keyboard('{ArrowRight}'); // T2 is at (1,0)

    const rows = await sql("select pos_x, pos_y from restaurant_tables where label = 'T1'");
    expect(rows[0]).toEqual({ pos_x: 0, pos_y: 0 });

    // And QUIETLY. The database refuses a stacked cell too, so "it didn't
    // move" alone proves nothing about this screen — what the client-side
    // check buys is not throwing a 409 banner at someone for a drop that was
    // obviously never going to work.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('the plan cannot push a table off the grid', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const plan = await screen.findByTestId('floor-plan');
    const t1 = within(plan).getByRole('button', { name: /^T1, / }); // already at 0,0
    t1.focus();
    await user.keyboard('{ArrowLeft}{ArrowUp}');

    const rows = await sql("select pos_x, pos_y from restaurant_tables where label = 'T1'");
    expect(rows[0]).toEqual({ pos_x: 0, pos_y: 0 });
    // Clamped here, not bounced off the server's 400 — same reasoning as the
    // stacking check above.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('the POS floor map draws the same arrangement', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'POS' }));

    // Seeded two-by-two, so the till's grid is two columns and each card sits
    // in the cell the owner put it in.
    const cardFor = async (label) => (await screen.findByText(label)).closest('div.rounded-2xl');
    expect(await cardFor('T1')).toHaveStyle({ gridColumn: '1', gridRow: '1' });
    // A second COLUMN, not just a second row: without one, a layout collapsed
    // to a single column would satisfy every other assertion here.
    expect(await cardFor('T2')).toHaveStyle({ gridColumn: '2', gridRow: '1' });
    expect(await cardFor('T3')).toHaveStyle({ gridColumn: '1', gridRow: '2' });
    expect(await cardFor('T4')).toHaveStyle({ gridColumn: '2', gridRow: '2' });
  });

  test('owner can add a table inline, and its QR token resolves to a real, working menu', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    await user.type(await screen.findByLabelText('Table name'), 'T9');
    const capacity = screen.getByLabelText('Capacity');
    await user.clear(capacity);
    await user.type(capacity, '5');
    await user.click(screen.getByRole('button', { name: /Add table/ }));

    const row = await listRow('T9');
    await waitFor(() => expect(within(row).getByText('5')).toBeInTheDocument());
    // It lands on the plan too, in the first free cell.
    expect(within(screen.getByTestId('floor-plan')).getByRole('button', { name: /^T9, / })).toBeInTheDocument();

    const token = (await sql("select qr_token from restaurant_tables where label = 'T9'"))[0].qr_token;
    expect((await api('GET', `/api/menu/${token}`)).body.table.label).toBe('T9');

    await sql("update restaurant_tables set deleted_at = now(), pos_x = null, pos_y = null where label = 'T9'");
  });

  test("a duplicate table label shows the server's error inline", async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    await user.type(await screen.findByLabelText('Table name'), 'T1');
    await user.click(screen.getByRole('button', { name: /Add table/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  test('capacity is changed from the list with a stepper', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const row = await listRow('T4');
    expect(within(row).getByText('6')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'More seats at T4' }));

    await waitFor(async () => {
      const rows = await sql("select seats from restaurant_tables where label = 'T4'");
      expect(rows[0].seats).toBe(7);
    });

    await sql("update restaurant_tables set seats = 6 where label = 'T4'");
  });

  test('renaming a table keeps its printed QR code working', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const row = await listRow('T4');
    await user.click(within(row).getByRole('button', { name: 'Edit T4' }));
    const form = await screen.findByRole('dialog', { name: 'Edit T4' });
    await user.clear(within(form).getByLabelText('Table name'));
    await user.type(within(form).getByLabelText('Table name'), 'Terrace');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(screen.getByRole('table')).getByText('Terrace')).toBeInTheDocument();

    const menu = (await api('GET', `/api/menu/${tokens.T4}`)).body;
    expect(menu.table.label).toBe('Terrace');

    await sql("update restaurant_tables set label = 'T4' where qr_token = $1", [tokens.T4]);
  });

  test('pausing a table stops its QR code taking orders, and resuming brings it back', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    let row = await listRow('T3');
    await user.click(within(row).getByRole('button', { name: 'Pause T3' }));

    await waitFor(async () => expect((await api('GET', `/api/menu/${tokens.T3}`)).status).toBe(403));
    row = await listRow('T3');
    expect(within(row).getByText('Paused')).toBeInTheDocument();
    // And the plan says so too.
    expect(within(screen.getByTestId('floor-plan')).getByRole('button', { name: /^T3, Paused/ })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Resume T3' }));
    await waitFor(async () => expect((await api('GET', `/api/menu/${tokens.T3}`)).status).toBe(200));
  });

  // --- the QR code ----------------------------------------------------------

  test('a table\'s QR code can be opened and downloaded', async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const row = await listRow('T1');
    await user.click(within(row).getByRole('button', { name: 'Show the QR code for T1' }));

    const dialog = await screen.findByRole('dialog', { name: 'QR code for T1' });
    const img = await within(dialog).findByRole('img', { name: 'QR code for table T1' });
    expect(img.src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(within(dialog).getByText(new RegExp(`/t/${tokens.T1}$`))).toBeInTheDocument();

    // The download is the SVG we already generated, named after the table.
    const link = within(dialog).getByRole('link', { name: /Download SVG/ });
    expect(link).toHaveAttribute('download', 't1-qr.svg');
    expect(link.getAttribute('href')).toBe(img.getAttribute('src'));
    expect(within(dialog).getByRole('button', { name: /Download PNG/ })).toBeInTheDocument();
  });

  // --- retiring a table -----------------------------------------------------

  test('removing a table asks first, and says what happens to its orders', async () => {
    await sql("insert into restaurant_tables (restaurant_id, label, seats, pos_x, pos_y) select id, 'Spare', 2, 5, 5 from restaurants where slug = 'chai-point'");

    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    let row = await listRow('Spare');
    await user.click(within(row).getByRole('button', { name: 'Remove Spare' }));
    expect(within(row).getByText(/Its past orders stay/)).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Keep' }));
    expect(within(screen.getByRole('table')).getByText('Spare')).toBeInTheDocument();

    row = await listRow('Spare');
    await user.click(within(row).getByRole('button', { name: 'Remove Spare' }));
    await user.click(within(row).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Spare')).not.toBeInTheDocument());
    // Soft: the row is still there for history, just retired.
    const rows = await sql("select deleted_at from restaurant_tables where label = 'Spare'");
    expect(rows[0].deleted_at).not.toBeNull();
  });

  test('a table that still owes money refuses to be removed, and says why', async () => {
    await sql("insert into restaurant_tables (restaurant_id, label, seats, pos_x, pos_y) select id, 'Owing', 2, 6, 6 from restaurants where slug = 'chai-point'");
    const token = (await sql("select qr_token from restaurant_tables where label = 'Owing'"))[0].qr_token;

    const menu = (await api('GET', `/api/menu/${token}`)).body;
    const item = menu.categories.flatMap((c) => c.items)[0];
    await api('POST', '/api/cart/items', { session: menu.session.id, body: { menu_item_id: item.id, quantity: 1 } });
    const cart = (await api('GET', '/api/cart', { session: menu.session.id })).body;
    await api('POST', '/api/orders', { session: menu.session.id, body: { cart_id: cart.cart_id } });

    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /Seating plan/);

    const row = await listRow('Owing');
    await user.click(within(row).getByRole('button', { name: 'Remove Owing' }));
    await user.click(within(row).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText(/Settle this table before removing it/)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Owing')).toBeInTheDocument();

    // Delete it outright, not just mark it paid: an unapproved QR order left
    // behind sits in POS's queue and every later POS test trips over it.
    await sql("delete from orders where table_id = (select id from restaurant_tables where label = 'Owing')");
    await sql("update restaurant_tables set deleted_at = now(), pos_x = null, pos_y = null where label = 'Owing'");
  });

  // --- User account ---------------------------------------------------------

  test('renaming yourself updates the sidebar too, not just the form', async () => {
    const user = userEvent.setup();
    await openSettings(user, SECOND_STAFF, /User account/);

    const name = await screen.findByLabelText('Display name');
    expect(name).toHaveValue('Ravi');

    await user.clear(name);
    await user.type(name, 'Ravi Kumar');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    // The name propagates back into the shell's identity, so the account card
    // above the form reads the new name rather than the one signed in with.
    // (The sidebar names the café, not the person — see the sign-in test.)
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.queryByText('Ravi', { exact: true })).not.toBeInTheDocument();

    await sql("update staff_members set display_name = 'Ravi' where user_id = $1", [SECOND_STAFF]);
  });

  test('your own role is shown but never editable from here', async () => {
    const user = userEvent.setup();
    await openSettings(user, KITCHEN_USER, /User account/);

    await screen.findByRole('heading', { name: 'Your account' });
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /role/i })).not.toBeInTheDocument();
  });

  test("a password change goes to the login provider, never through Petuk's API", async () => {
    const user = userEvent.setup();
    await openSettings(user, STAFF_USER, /User account/);

    await user.type(await screen.findByLabelText('New password'), 'sixchars');
    await user.type(screen.getByLabelText('Confirm new password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/don't match/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'sixchars');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    expect(passwordChanges).toEqual(['sixchars']);
  });
});

describe('the owner dashboard shell (step 7 slice 1)', () => {
  test('owner sees Dashboard, POS and Staff tabs; staff see none of them', async () => {
    const owner = userEvent.setup();
    await signIn(owner, STAFF_USER);
    expect(await screen.findByRole('button', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'POS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Staff' })).toBeInTheDocument();
  });

  test('the kitchen sees only the board, Recent and Menu', async () => {
    const kitchen = userEvent.setup();
    await signIn(kitchen, KITCHEN_USER);
    await screen.findByRole('heading', { name: 'Order board' });
    expect(screen.queryByRole('button', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'POS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Staff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tables' })).not.toBeInTheDocument();
  });

  // Front of house reaches the till — this is what stops QR orders waiting for
  // the owner to be standing at it.
  test('front-of-house staff get POS, but not Tables, Dashboard or Staff', async () => {
    const staff = userEvent.setup();
    await signIn(staff, SECOND_STAFF);
    await screen.findByRole('heading', { name: 'Order board' });
    expect(await screen.findByRole('button', { name: 'POS' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Staff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tables' })).not.toBeInTheDocument();
  });

  test('every owner-only tab is real — no placeholders left', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Chai Point Cafe' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Staff' }));
    expect(await screen.findByRole('heading', { name: 'Your team' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'POS' }));
    expect(await screen.findByRole('button', { name: 'Floor' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search items' })).toBeInTheDocument();
  });
});

describe('the POS tab (step 7 slices 2-3)', () => {
  const openPOS = async (user) => {
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'POS' }));
    await screen.findByRole('button', { name: 'Floor' });
  };

  test('a table with no active order shows free on the floor map', async () => {
    const user = userEvent.setup();
    // Earlier describe blocks in this shared-DB file leave active orders on
    // several tables — force a clean slate for T1 regardless of that.
    await sql(
      `update orders set status = 'cancelled'
        where table_id = (select id from restaurant_tables where label = 'T1') and status in ('placed', 'preparing', 'ready')`,
    );
    await openPOS(user);
    const t1 = screen.getAllByText('T1')[0].closest('button');
    expect(within(t1).getByText('free')).toBeInTheDocument();
  });

  test('selecting a table, adding items, and sending to kitchen places a real order', async () => {
    const user = userEvent.setup();
    await openPOS(user);

    await user.click((await screen.findByText('T3')).closest('button'));
    expect(await screen.findAllByText('T3')).toHaveLength(2); // the floor card, and now the cart header badge

    const chaiCard = (await screen.findByText('Masala Chai')).closest('button');
    await user.click(chaiCard);
    await user.click(chaiCard); // quantity 2

    const cartLine = (await screen.findAllByText('Masala Chai')).map((el) => el.closest('li')).find(Boolean);
    expect(within(cartLine).getByText('2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send to kitchen' }));

    // The cart clears and the table now shows occupied on the floor map.
    // (Two "T3"s on screen now: the floor card, and the still-selected
    // cart header badge — the floor card renders first in DOM order.)
    await waitFor(() => expect(screen.queryByText('No items yet')).toBeInTheDocument());
    const t3Card = screen.getAllByText('T3')[0].closest('button');
    await waitFor(() => expect(within(t3Card).getByText('occupied')).toBeInTheDocument());

    // ...and shows up on the real kitchen board, exactly like a QR order.
    // Identified by order_number, not by item name — other tests in this
    // shared-DB file also leave active "Masala Chai" orders on other tables.
    const [{ order_number: orderNumber }] = await sql(
      `select order_number from orders
        where table_id = (select id from restaurant_tables where label = 'T3')
        order by placed_at desc limit 1`,
    );
    await user.click(screen.getByRole('button', { name: 'Board' }));
    const newColumn = await screen.findByRole('region', { name: 'New' });
    const card = within(newColumn).getByText(`#${orderNumber}`).closest('article');
    expect(within(card).getByText('Table T3')).toBeInTheDocument();
    expect(within(card).getByText(/2 × Masala Chai/)).toBeInTheDocument();
  });

  test('switching tables discards the in-progress cart', async () => {
    const user = userEvent.setup();
    await openPOS(user);

    await user.click((await screen.findByText('T4')).closest('button'));
    await user.click((await screen.findByText('Filter Coffee')).closest('button'));
    await waitFor(() => expect(screen.queryByText('No items yet')).not.toBeInTheDocument());

    await user.click(screen.getByText('T1').closest('button'));
    expect(await screen.findByText('No items yet')).toBeInTheDocument();
  });

  test('the "Send to kitchen" button is disabled with no table selected or an empty cart', async () => {
    const user = userEvent.setup();
    await openPOS(user);
    expect(screen.getByRole('button', { name: 'Send to kitchen' })).toBeDisabled();

    await user.click((await screen.findByText('T2')).closest('button'));
    expect(screen.getByRole('button', { name: 'Send to kitchen' })).toBeDisabled();

    await user.click((await screen.findByText('Masala Chai')).closest('button'));
    expect(screen.getByRole('button', { name: 'Send to kitchen' })).not.toBeDisabled();
  });

  test('search and category filters narrow the item grid', async () => {
    const user = userEvent.setup();
    await openPOS(user);

    await user.type(screen.getByRole('searchbox', { name: 'Search items' }), 'chai');
    expect(await screen.findByText('Masala Chai')).toBeInTheDocument();
    expect(screen.queryByText('Filter Coffee')).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Search items' }));
    await user.click(screen.getByRole('button', { name: 'Desserts' }));
    expect(await screen.findByText('Chocolate Brownie')).toBeInTheDocument();
    expect(screen.queryByText('Masala Chai')).not.toBeInTheDocument();
  });

  test('item cards show the same veg/non-veg mark as the customer menu and the Menu tab', async () => {
    const user = userEvent.setup();
    await openPOS(user);

    const chaiCard = (await screen.findByText('Masala Chai')).closest('button');
    expect(within(chaiCard).getByRole('img', { name: 'Vegetarian' })).toBeInTheDocument();
  });

  // Checkout is deliberately NOT gated on 'served' any more: paying before the
  // food lands is normal, and the cashier now confirms against an itemised
  // bill rather than tapping blind. See server/src/services/tables.js.
  test('an occupied table shows what it owes and offers checkout even while the kitchen is still working', async () => {
    const user = userEvent.setup();
    await openPOS(user);

    await user.click((await screen.findByText('T2')).closest('button'));
    await user.click((await screen.findByText('Filter Coffee')).closest('button'));
    await user.click(screen.getByRole('button', { name: 'Send to kitchen' }));

    await waitFor(() => {
      const t2Card = screen.getAllByText('T2')[0].closest('button').parentElement;
      expect(within(t2Card).getByText('occupied')).toBeInTheDocument();
    });
    expect(await screen.findByText(/unpaid orders? on this table/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Bill & checkout/ })).toBeInTheDocument();
  });

  test('a QR order waits in the QR tab and only reaches the kitchen once approved', async () => {
    const user = userEvent.setup();
    const order = await placeUnapproved('T2', 'Masala Chai', 'less sugar');
    await openPOS(user);

    // The waiting count is on the tab itself, so it's visible from the floor.
    const qrTab = await screen.findByRole('button', { name: /QR/ });
    await waitFor(() => expect(qrTab).toHaveTextContent('1'));

    await user.click(qrTab);
    const card = (await screen.findByText('QR order')).closest('article');
    expect(within(card).getByText('T2')).toBeInTheDocument();
    expect(within(card).getByText(/1× Masala Chai/)).toBeInTheDocument();
    expect(within(card).getByText('less sugar')).toBeInTheDocument();

    // Not on the kitchen board yet.
    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.queryByText(`#${order.order_number}`)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'POS' }));
    await user.click(await screen.findByRole('button', { name: /QR/ }));
    await user.click(await screen.findByRole('button', { name: /Approve & send to kitchen/ }));

    // It leaves the queue and turns up on the board like any other order.
    await waitFor(() => expect(screen.queryByText('QR order')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(await screen.findByText(`#${order.order_number}`)).toBeInTheDocument();
  });

  test('rejecting a QR order cancels it instead of sending it to the kitchen', async () => {
    const user = userEvent.setup();
    const order = await placeUnapproved('T3', 'Filter Coffee');
    await openPOS(user);

    await user.click(await screen.findByRole('button', { name: /QR/ }));
    await user.click(await screen.findByRole('button', { name: /Reject/ }));

    await waitFor(() => expect(screen.queryByText('QR order')).not.toBeInTheDocument());

    const [row] = await sql('select status from orders where id = $1', [order.id]);
    expect(row.status).toBe('cancelled');

    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.queryByText(`#${order.order_number}`)).not.toBeInTheDocument();
  });

  test('a table that ordered twice checks out as one merged bill, grouped by round', async () => {
    const user = userEvent.setup();
    await sql(
      `update orders set status = 'cancelled'
        where table_id = (select id from restaurant_tables where label = 'T3')
          and paid_at is null and status <> 'cancelled'`,
    );
    await openPOS(user);

    // Two separate trips to the kitchen, as a real second round would be.
    await user.click((await screen.findByText('T3')).closest('button'));
    await user.click((await screen.findByText('Masala Chai')).closest('button')); // 30.00
    await user.click(screen.getByRole('button', { name: 'Send to kitchen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send to kitchen' })).toBeDisabled());

    await user.click((await screen.findByText('Filter Coffee')).closest('button')); // 40.00
    await user.click(screen.getByRole('button', { name: 'Send to kitchen' }));

    // The running total comes from a floor refetch, so wait for the second
    // round to land rather than reading the button the first one left behind.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Bill & checkout/ })).toHaveTextContent('70.00'),
    );
    await user.click(screen.getByRole('button', { name: /Bill & checkout/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 orders merged')).toBeInTheDocument();
    expect(within(dialog).getByText(/Round 1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Round 2/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1× Masala Chai/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1× Filter Coffee/)).toBeInTheDocument();
  });

  test('Bill & checkout settles the table: itemised bill, a payment method, and the table frees up', async () => {
    const user = userEvent.setup();
    // Earlier tests in this shared-DB file leave unpaid orders around — this
    // one asserts an exact bill total, so T4 starts clear.
    await sql(
      `update orders set status = 'cancelled'
        where table_id = (select id from restaurant_tables where label = 'T4')
          and paid_at is null and status <> 'cancelled'`,
    );
    await openPOS(user);

    await user.click((await screen.findByText('T4')).closest('button'));
    await user.click((await screen.findByText('Masala Chai')).closest('button')); // 30.00
    await user.click(screen.getByRole('button', { name: 'Send to kitchen' }));

    const billButton = await screen.findByRole('button', { name: /Bill & checkout/ });
    expect(billButton).toHaveTextContent('30.00');
    await user.click(billButton);

    // The dialog shows what is actually owed, line by line — Confirm is always
    // agreeing to a bill, never just to a number on a button.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1× Masala Chai/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'UPI' }));
    await user.click(within(dialog).getByRole('button', { name: /Confirm payment/ }));

    // The dialog stays open on a receipt rather than vanishing — the cashier
    // reads the amount back before dismissing it.
    expect(await screen.findByText('Payment received')).toBeInTheDocument();
    const receipt = screen.getByRole('dialog');
    expect(within(receipt).getByText('₹30.00')).toBeInTheDocument();
    expect(within(receipt).getByText(/upi/i)).toBeInTheDocument();

    await user.click(within(receipt).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('Payment received')).not.toBeInTheDocument());

    await waitFor(() => {
      const t4Card = screen.getAllByText('T4')[0].closest('button').parentElement;
      expect(within(t4Card).getByText('free')).toBeInTheDocument();
    });

    // It recorded HOW the money was taken, not merely that the table cleared.
    const [payment] = await sql(
      `select p.method, p.status from payments p
         join orders o on o.id = p.order_id
        where o.table_id = (select id from restaurant_tables where label = 'T4')
        order by p.created_at desc limit 1`,
    );
    expect(payment.method).toBe('upi');
    expect(payment.status).toBe('succeeded');
  });
});

describe('staff management (step 6 slice 5)', () => {
  const openStaff = async (user) => {
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'Staff' }));
    await screen.findByRole('heading', { name: 'Your team' });
  };

  test('the team lists everyone with their role, and a role can be changed', async () => {
    const user = userEvent.setup();
    await openStaff(user);

    // Scoped by each row's own role picker: "Mita" also appears in the
    // sidebar's identity card, so a bare text query is ambiguous.
    const picker = screen.getByLabelText('Role for Bikash');
    expect(screen.getByLabelText('Role for Mita')).toHaveValue('owner');
    expect(picker).toHaveValue('kitchen');

    await user.selectOptions(picker, 'staff');

    // Persisted, not just held in the picker.
    await waitFor(async () => {
      const [row] = await sql('select role from staff_members where display_name = $1', ['Bikash']);
      expect(row.role).toBe('staff');
    });

    await sql(`update staff_members set role = 'kitchen' where display_name = 'Bikash'`); // leave the fixture as found
  });

  test('inviting pre-authorises an email — no account is created, and it shows as waiting', async () => {
    const user = userEvent.setup();
    await openStaff(user);

    await user.click(screen.getByRole('button', { name: /Invite someone/ }));
    await user.type(screen.getByLabelText(/Email address/), 'Newbie@Example.com');
    await user.type(screen.getByLabelText(/Name/), 'Newbie');
    await user.click(screen.getByRole('radio', { name: /Kitchen/ }));
    await user.click(screen.getByRole('button', { name: 'Add to team' }));

    expect(await screen.findByText('newbie@example.com')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Waiting to sign up' })).toBeInTheDocument();

    // It's an invite, not a member: nothing was added to the team itself.
    const [{ n }] = await sql("select count(*)::int as n from staff_members where display_name = 'Newbie'");
    expect(n).toBe(0);
    const [invite] = await sql('select email, role from staff_invites where accepted_at is null');
    expect(invite).toMatchObject({ email: 'newbie@example.com', role: 'kitchen' });

    // And it can be withdrawn again.
    await user.click(screen.getByRole('button', { name: /Revoke invite for newbie@example.com/ }));
    await waitFor(() => expect(screen.queryByText('newbie@example.com')).not.toBeInTheDocument());
    const [{ n: left }] = await sql('select count(*)::int as n from staff_invites where accepted_at is null');
    expect(left).toBe(0);
  });

  test('the last owner cannot be demoted — the API refuses and the screen says why', async () => {
    const user = userEvent.setup();
    await openStaff(user);

    await user.selectOptions(screen.getByLabelText('Role for Mita'), 'staff');

    expect(await screen.findByRole('alert')).toHaveTextContent(/only owner/i);
    const [row] = await sql('select role from staff_members where display_name = $1', ['Mita']);
    expect(row.role).toBe('owner', 'still the owner');
  });

  test('removing someone asks first, and "Keep" leaves them alone', async () => {
    const user = userEvent.setup();
    await openStaff(user);

    await user.click(screen.getByRole('button', { name: /Remove Bikash/ }));
    await user.click(await screen.findByRole('button', { name: 'Keep' }));

    const [{ n }] = await sql("select count(*)::int as n from staff_members where display_name = 'Bikash'");
    expect(n).toBe(1, 'Keep means keep');
  });
});

describe('joining a café from an invite', () => {
  const NEWCOMER = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b';

  test('an invited person signs up and lands in the café with the role they were given', async () => {
    const user = userEvent.setup();
    await sql(
      `insert into staff_invites (restaurant_id, email, role, display_name)
       values ($1, 'newhire@example.com', 'kitchen', 'New Hire')`,
      ['11111111-1111-1111-1111-111111111111'],
    );

    render(<StaffApp auth={createFakeAuth(null, { signUpAs: NEWCOMER })} />);
    await screen.findByRole('heading', { name: 'Staff sign in' });

    // The invite created no login, so there has to be a way to make one.
    await user.click(screen.getByRole('button', { name: /Been invited/ }));
    await screen.findByRole('heading', { name: 'Create your account' });
    await user.type(screen.getByLabelText('Email'), 'newhire@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // Joining happens by itself, on their very first authenticated request.
    expect(await screen.findByRole('heading', { name: 'Order board' })).toBeInTheDocument();
    // The sidebar names the café they have just joined — which also means the
    // invite-claiming path carries the café's name back, not only its id.
    expect(within(screen.getByRole('navigation', { name: 'View' })).getByText('Chai Point Cafe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'POS' })).not.toBeInTheDocument(); // kitchen, not front of house

    const [row] = await sql('select role, display_name from staff_members where user_id = $1', [NEWCOMER]);
    expect(row).toEqual({ role: 'kitchen', display_name: 'New Hire' }); // the invite's own name was used
    const [{ n }] = await sql('select count(*)::int as n from staff_invites where accepted_at is null');
    expect(n).toBe(0, 'the invite is spent');
  });

  test('signing up without an invite is refused, not silently let in', async () => {
    const user = userEvent.setup();
    const stranger = '8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c';

    render(<StaffApp auth={createFakeAuth(null, { signUpAs: stranger })} />);
    await screen.findByRole('heading', { name: 'Staff sign in' });
    await user.click(screen.getByRole('button', { name: /Been invited/ }));
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/isn't linked to a café/)).toBeInTheDocument();
    const [{ n }] = await sql('select count(*)::int as n from staff_members where user_id = $1', [stranger]);
    expect(n).toBe(0);
  });

  test('when Supabase requires email confirmation, the screen says so instead of hanging', async () => {
    const user = userEvent.setup();
    render(<StaffApp auth={createFakeAuth(null, { signUpAs: NEWCOMER, requiresConfirmation: true })} />);
    await screen.findByRole('heading', { name: 'Staff sign in' });

    await user.click(screen.getByRole('button', { name: /Been invited/ }));
    await user.type(screen.getByLabelText('Email'), 'later@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/confirmation link/i);
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  });

  test('a sign-up error surfaces, and switching back to sign in clears it', async () => {
    const user = userEvent.setup();
    render(<StaffApp auth={createFakeAuth(null, { signUpAs: NEWCOMER })} />);
    await screen.findByRole('heading', { name: 'Staff sign in' });

    await user.click(screen.getByRole('button', { name: /Been invited/ }));
    await user.type(screen.getByLabelText('Email'), 'taken@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('User already registered');

    await user.click(screen.getByRole('button', { name: /Already have an account/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the dashboard (step 6 slice 4)', () => {
  const openDashboard = async (user) => {
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'Dashboard' }));
    await screen.findByRole('heading', { name: 'Chai Point Cafe' });
  };

  // The arithmetic is owned by server/test/dashboard.test.js, which truncates
  // the tables per test. This file shares one database with every other suite
  // in it, so asserting exact totals here would be asserting on leftovers.
  // What's worth checking at this level is that the screen shows what the
  // endpoint actually said, and keeps taken and owed apart.
  test("today's figures are rendered faithfully, with money taken kept apart from money owed", async () => {
    const user = userEvent.setup();
    const paid = await place('T1', 'Masala Chai'); // 30.00
    // The database enforces the status machine, so walk it rather than jump.
    for (const status of ['preparing', 'ready', 'served']) {
      await sql('update orders set status = $2 where id = $1', [paid.id, status]);
    }
    await sql('update orders set paid_at = now() where id = $1', [paid.id]);
    await place('T2', 'Filter Coffee'); // 40.00, still open

    await openDashboard(user);

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await realFetch(`${base}/api/dashboard/summary?tz=${encodeURIComponent(tz)}`, {
      headers: { Authorization: `Bearer valid-${STAFF_USER}` },
    });
    const { money } = await res.json();

    const taken = screen.getByText('Taken today').closest('div').parentElement;
    expect(within(taken).getByText(`₹${Number(money.taken_today).toFixed(2)}`)).toBeInTheDocument();

    const open = screen.getByText('Open on tables').closest('div').parentElement;
    expect(within(open).getByText(`₹${Number(money.open_on_tables).toFixed(2)}`)).toBeInTheDocument();

    // The settled bill is in one number and not the other — the distinction
    // the whole tile split exists for.
    expect(Number(money.taken_today)).toBeGreaterThanOrEqual(30);
    expect(Number(money.open_on_tables)).toBeGreaterThanOrEqual(40);
  });

  test('a QR order waiting for approval shows as waiting, and is a way into POS', async () => {
    const user = userEvent.setup();
    await placeUnapproved('T3', 'Masala Chai');
    await openDashboard(user);

    const waiting = await screen.findByRole('button', { name: /Awaiting approval/ });
    expect(waiting).toHaveTextContent('1');

    // The tile is the shortest path to doing something about it.
    await user.click(waiting);
    expect(await screen.findByRole('button', { name: 'Floor' })).toBeInTheDocument();
  });

  test('best sellers rank what actually sold today', async () => {
    const user = userEvent.setup();
    await place('T4', 'Chocolate Brownie');
    await place('T4', 'Chocolate Brownie');
    await openDashboard(user);

    const selling = (await screen.findByText('Selling today')).closest('div');
    expect(within(selling).getByText('Chocolate Brownie')).toBeInTheDocument();
  });
});

describe('dashboard analytics', () => {
  const openDashboard = async (user) => {
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'Dashboard' }));
    await screen.findByRole('heading', { name: 'Chai Point Cafe' });
  };

  test('sales by hour draws a labelled bar per hour, readable without a mouse', async () => {
    const user = userEvent.setup();
    await place('T1', 'Masala Chai'); // 30.00, this hour
    await openDashboard(user);

    expect(await screen.findByText('Sales by hour')).toBeInTheDocument();

    // Each bar carries its own value and order count, so the chart isn't a
    // picture only a sighted mouse user can read.
    const hour = new Date().getHours();
    const bar = await screen.findByRole('img', { name: new RegExp(`^${hour}h: ₹`) });
    expect(bar).toHaveAccessibleName(/order/);
  });

  test('the payment mix and the QR-vs-counter split are both shown', async () => {
    const user = userEvent.setup();
    await openDashboard(user);

    expect(screen.getByText('How people paid')).toBeInTheDocument();
    expect(screen.getByText('Where orders came from')).toBeInTheDocument();
    // The channel split is inferred from cart_id, so a QR order must land on
    // the QR side — this is the assertion that keeps that inference honest.
    expect(screen.getByText(/^QR \(\d+\)$/)).toBeInTheDocument();
  });

  test('a comparison against yesterday appears once there is something to compare', async () => {
    const user = userEvent.setup();
    await sql(
      `insert into orders (restaurant_id, table_id, guest_session_id, status, subtotal, total_amount, approved_at, placed_at)
       select o.restaurant_id, o.table_id, o.guest_session_id, 'served', 50, 50, now(), now() - interval '1 day'
         from orders o limit 1`,
    );
    await place('T2', 'Filter Coffee');
    await openDashboard(user);

    // Both the takings tile and the orders tile carry a comparison.
    const deltas = await screen.findAllByText(/vs yesterday|First takings today|First orders today/);
    expect(deltas.length).toBeGreaterThan(0);
  });

  test('the last-7-days chart is there alongside today', async () => {
    const user = userEvent.setup();
    await openDashboard(user);
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
  });
});
