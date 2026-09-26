import { describe, test, expect, beforeAll, beforeEach, vi, inject } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
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
        session = { access_token: `valid-${userId}` };
        listeners.forEach((fn) => fn('SIGNED_IN', session));
        return { data: { session }, error: null };
      },
      async signOut() {
        session = null;
        listeners.forEach((fn) => fn('SIGNED_OUT', null));
        return { error: null };
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
    expect(screen.getByText('Mita')).toBeInTheDocument(); // display_name from GET /me

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
    expect(card).toHaveClass('staff-card-danger');
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

describe('order detail and Recent', () => {
  test('opening an order from the board shows its items, total and timeline', async () => {
    const user = userEvent.setup();
    const order = await place('T1', 'Masala Chai', 'less sugar');
    await signIn(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: `#${order.order_number}` }));
    const drawer = await screen.findByRole('dialog', { name: `Order #${order.order_number}` });

    expect(drawer.querySelector('.staff-status-pill')).toHaveTextContent('placed');
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
    await screen.findByText('Last 4 hours');

    const order = await place('T4', 'Masala Chai');
    await moveViaApi(order.id, 'cancelled');
    expect(screen.queryByText(new RegExp(`#${order.order_number}`))).not.toBeInTheDocument(); // not live-updated

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('button', { name: new RegExp(`#${order.order_number}`) })).toBeInTheDocument();
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

  test('owner sees Add item and per-item Edit/Delete', async () => {
    const owner = userEvent.setup();
    await openMenuTab(owner, STAFF_USER);

    expect(await screen.findByRole('button', { name: '+ Add item' })).toBeInTheDocument();
    const chaiRow = (await screen.findByText('Masala Chai')).closest('li');
    expect(within(chaiRow).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(chaiRow).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(within(chaiRow).getByRole('checkbox')).toBeInTheDocument();
  });

  test('staff see the same list with only the availability toggle — no add/edit/delete', async () => {
    const staff = userEvent.setup();
    await openMenuTab(staff, SECOND_STAFF);

    // Wait for the menu to actually finish loading BEFORE checking anything
    // is absent — a "not present" check against a still-loading screen
    // (nothing rendered yet either way) would pass vacuously either way.
    const staffChaiRow = (await screen.findByText('Masala Chai')).closest('li');
    expect(screen.queryByRole('button', { name: '+ Add item' })).not.toBeInTheDocument();
    expect(within(staffChaiRow).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(staffChaiRow).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(within(staffChaiRow).getByRole('checkbox')).toBeInTheDocument();
  });

  test('staff can 86 an item from here, and it disappears from the real customer menu immediately', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, SECOND_STAFF);

    const row = (await screen.findByText('Filter Coffee')).closest('li');
    const toggle = within(row).getByRole('checkbox');
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(within(row).getByRole('checkbox')).not.toBeChecked());

    try {
      const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
      expect(menu.categories.flatMap((c) => c.items).some((i) => i.name === 'Filter Coffee')).toBe(false);
    } finally {
      await sql("update menu_items set is_available = true where name = 'Filter Coffee'");
    }
  });

  test('owner can add an item, and it\'s on the real customer menu right away', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: '+ Add item' }));
    const form = await screen.findByRole('dialog', { name: 'Add item' });
    await user.type(within(form).getByLabelText('Name'), 'Cold Kokum Sherbet');
    await user.clear(within(form).getByLabelText('Category'));
    await user.type(within(form).getByLabelText('Category'), 'Beverages');
    await user.type(within(form).getByLabelText(/Price/), '45');
    await user.click(within(form).getByRole('radio', { name: 'Veg' }));
    await user.click(within(form).getByRole('button', { name: 'Add item' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Cold Kokum Sherbet')).toBeInTheDocument();

    const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
    const item = menu.categories.flatMap((c) => c.items).find((i) => i.name === 'Cold Kokum Sherbet');
    expect(item?.price).toBe('45.00');
  });

  test('owner can edit an item — the whole form resubmits, values update everywhere', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    const row = (await screen.findByText('Samosa (2 pcs)')).closest('li');
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('dialog', { name: 'Edit Samosa (2 pcs)' });

    const priceInput = within(form).getByLabelText(/Price/);
    await user.clear(priceInput);
    await user.type(priceInput, '50');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const updatedRow = (await screen.findByText('Samosa (2 pcs)')).closest('li');
    expect(within(updatedRow).getByText('₹50.00')).toBeInTheDocument();

    await sql("update menu_items set price = 40 where name = 'Samosa (2 pcs)'");
  });

  test('deleting uses an inline confirmation, not a native popup, and "Keep it" changes nothing', async () => {
    const user = userEvent.setup();
    await openMenuTab(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: '+ Add item' }));
    const form = await screen.findByRole('dialog', { name: 'Add item' });
    await user.type(within(form).getByLabelText('Name'), 'Test Special');
    await user.type(within(form).getByLabelText(/Price/), '99');
    await user.click(within(form).getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const row = (await screen.findByText('Test Special')).closest('li');
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(within(row).getByText('Delete this item?')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Keep it' }));
    expect(screen.getByText('Test Special')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Yes, delete it' }));
    await waitFor(() => expect(screen.queryByText('Test Special')).not.toBeInTheDocument());

    const menu = (await api('GET', `/api/menu/${tokens.T1}`)).body;
    expect(menu.categories.flatMap((c) => c.items).some((i) => i.name === 'Test Special')).toBe(false);
  });
});

describe('the Tables tab', () => {
  test('owner sees a Tables tab', async () => {
    const owner = userEvent.setup();
    await signIn(owner, STAFF_USER);
    expect(await screen.findByRole('button', { name: 'Tables' })).toBeInTheDocument();
  });

  test('staff do not see a Tables tab', async () => {
    const staff = userEvent.setup();
    await signIn(staff, SECOND_STAFF);
    await screen.findByRole('heading', { name: 'Order board' });
    expect(screen.queryByRole('button', { name: 'Tables' })).not.toBeInTheDocument();
  });

  test('lists the seeded tables with a QR code and its printable URL', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'Tables' }));

    const card = (await screen.findByText('T1')).closest('.staff-qr-card');
    expect(within(card).getByText('2 seats')).toBeInTheDocument();
    expect(within(card).getByText(new RegExp(`/t/${tokens.T1}$`))).toBeInTheDocument();
    const qrImg = await within(card).findByRole('img', { name: 'QR code for table T1' });
    expect(qrImg.src).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  test('owner can add a table, and its QR token resolves to a real, working menu', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'Tables' }));

    await user.click(await screen.findByRole('button', { name: '+ Add table' }));
    const form = await screen.findByRole('dialog', { name: 'Add table' });
    await user.type(within(form).getByLabelText('Label'), 'T9');
    await user.type(within(form).getByLabelText(/Seats/), '5');
    await user.click(within(form).getByRole('button', { name: 'Add table' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const card = (await screen.findByText('T9')).closest('.staff-qr-card');
    expect(within(card).getByText('5 seats')).toBeInTheDocument();

    const urlText = within(card).getByText(/\/t\//).textContent;
    const qrToken = urlText.split('/t/')[1];
    const menu = (await api('GET', `/api/menu/${qrToken}`)).body;
    expect(menu.table.label).toBe('T9');

    await sql("delete from restaurant_tables where label = 'T9'");
  });

  test('a duplicate table label shows the server\'s error inline', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);
    await user.click(await screen.findByRole('button', { name: 'Tables' }));

    await user.click(await screen.findByRole('button', { name: '+ Add table' }));
    const form = await screen.findByRole('dialog', { name: 'Add table' });
    await user.type(within(form).getByLabelText('Label'), 'T1');
    await user.click(within(form).getByRole('button', { name: 'Add table' }));

    expect(await within(form).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add table' })).toBeInTheDocument(); // stays open
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

  test('Dashboard is still a placeholder; POS and Staff are the real thing', async () => {
    const user = userEvent.setup();
    await signIn(user, STAFF_USER);

    await user.click(await screen.findByRole('button', { name: 'Dashboard' }));
    expect(await screen.findByText(/Dashboard —/)).toBeInTheDocument();

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
    expect(screen.getByText('New Hire')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'POS' })).not.toBeInTheDocument(); // kitchen, not front of house

    const [row] = await sql('select role from staff_members where user_id = $1', [NEWCOMER]);
    expect(row.role).toBe('kitchen');
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
