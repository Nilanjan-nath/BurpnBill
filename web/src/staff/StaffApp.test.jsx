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
const STAFF_USER = inject('staffUserId');
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
  return res.body.order;
}

// A fake Supabase Auth client: same shape as the real supabase-js client
// (see useStaffSession.js), no network. On success it produces a token the
// server's fake verifier (../test/globalSetup.js) will accept.
function createFakeAuth(userId) {
  let session = null;
  const listeners = new Set();
  return {
    auth: {
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

    const movedCard = within(screen.getByRole('region', { name: 'Preparing' })).getByText(`#${order.order_number}`).closest('article');
    expect(within(movedCard).getByRole('button', { name: 'Mark ready' })).toBeInTheDocument();
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

    const order = await place('T3', 'Masala Chai'); // arrives as a live order_created push, not the initial load
    await screen.findByText(`#${order.order_number}`);

    await waitFor(() => expect(document.title).toMatch(/^\(1\) New order/));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(document.title).toBe('Petuk staff — Order board'));
  });

  test('"Turn on sound" arms it, without replaying for orders already on the board', async () => {
    const user = userEvent.setup();
    await place('T4', 'Masala Chai'); // already on the board before sound is armed — must not chime retroactively
    await signIn(user, STAFF_USER);

    const soundButton = await screen.findByRole('button', { name: '🔔 Turn on sound' });
    await user.click(soundButton);
    expect(screen.queryByRole('button', { name: '🔔 Turn on sound' })).not.toBeInTheDocument();

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
