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
    within(newColumn).getByText(`#${order.order_number}`); // the board has loaded this order as "placed"

    // Another device moves it first, behind the board's back — the UI still
    // shows the now-stale "Start preparing" button until it acts and finds out.
    const direct = await realFetch(`${base}/api/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer valid-${STAFF_USER}` },
      body: JSON.stringify({ status: 'preparing' }),
    });
    expect(direct.status).toBe(200);

    const card = within(newColumn).getByText(`#${order.order_number}`).closest('article');
    await user.click(within(card).getByRole('button', { name: 'Start preparing' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already moved to "preparing" by Mita/);
    // And the board resyncs: the order now correctly shows under Preparing.
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Preparing' })).getByText(`#${order.order_number}`)).toBeInTheDocument());
  });
});
