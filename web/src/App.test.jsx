import { describe, test, expect, beforeAll, beforeEach, vi, inject } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';

// The real React app -> the real Express API -> a real Postgres (see
// test/globalSetup.js). Nothing here is mocked except the network wire, which
// a few tests cut on purpose.

const base = inject('apiBase');
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

async function visit(table = 'T1') {
  window.history.replaceState(null, '', `/t/${tokens[table]}`);
  const view = render(<App />);
  await screen.findByRole('heading', { name: 'Chai Point Cafe' });
  return view;
}

const orderCount = async () => Number((await sql('select count(*) n from orders'))[0].n);

async function addToCart(user, itemName, { extra = 0, note } = {}) {
  await user.click(screen.getByRole('button', { name: `Add ${itemName}` }));
  const sheet = await screen.findByRole('dialog', { name: `Add ${itemName}` });
  for (let i = 0; i < extra; i++) await user.click(within(sheet).getByRole('button', { name: `Increase quantity of ${itemName}` }));
  if (note) await user.type(within(sheet).getByRole('textbox'), note);
  await user.click(within(sheet).getByRole('button', { name: /^Add ·/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

const openCart = (user) => user.click(screen.getByRole('button', { name: /^View order/ }));

describe('menu', () => {
  test('shows the cafe, table, categories, veg marks and prices', async () => {
    await visit('T2');
    expect(screen.getByText('Table T2')).toBeInTheDocument();
    for (const category of ['Beverages', 'Desserts', 'Mains', 'Snacks']) {
      expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
    }
    const chai = screen.getByText('Masala Chai').closest('li');
    expect(within(chai).getByText('₹30.00')).toBeInTheDocument();
    expect(within(chai).getByRole('img', { name: 'Vegetarian' })).toBeInTheDocument();
    const puff = screen.getByText('Chicken Puff').closest('li');
    expect(within(puff).getByRole('img', { name: 'Non-vegetarian' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View order/ })).not.toBeInTheDocument();
  });

  test('a menu item switched off while the phone was in a pocket disappears on return', async () => {
    await visit();
    expect(screen.getByText('Cold Coffee')).toBeInTheDocument();
    await sql("update menu_items set is_available = false where name = 'Cold Coffee'");
    try {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(screen.queryByText('Cold Coffee')).not.toBeInTheDocument());
    } finally {
      await sql("update menu_items set is_available = true where name = 'Cold Coffee'");
    }
  });

  test('opening the page makes exactly one guest session, even if the tab regains focus mid-load', async () => {
    const count = async () => Number((await sql('select count(*) n from guest_sessions'))[0].n);
    const before = await count();

    window.history.replaceState(null, '', `/t/${tokens.T2}`);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    render(<App />);
    document.dispatchEvent(new Event('visibilitychange')); // before the first load has finished
    await screen.findByRole('heading', { name: 'Chai Point Cafe' });

    expect(await count()).toBe(before + 1);
  });

  test('unknown QR code, paused table and no QR code each get a clear message', async () => {
    window.history.replaceState(null, '', '/t/not-a-real-token');
    const unknown = render(<App />);
    expect(await screen.findByRole('heading', { name: "We don't recognise this QR code" })).toBeInTheDocument();
    unknown.unmount();

    await sql("update restaurant_tables set is_active = false where label = 'T4'");
    try {
      window.history.replaceState(null, '', `/t/${tokens.T4}`);
      const paused = render(<App />);
      expect(await screen.findByRole('heading', { name: 'Ordering is paused' })).toBeInTheDocument();
      paused.unmount();
    } finally {
      await sql("update restaurant_tables set is_active = true where label = 'T4'");
    }

    window.history.replaceState(null, '', '/');
    render(<App />);
    expect(screen.getByRole('heading', { name: "Scan your table's QR code" })).toBeInTheDocument();
  });
});

describe('cart', () => {
  test('add with a note and quantity, then edit quantity and note, then remove', async () => {
    const user = userEvent.setup();
    await visit();

    await addToCart(user, 'Masala Chai', { note: 'less sugar' });
    await openCart(user);
    expect(await screen.findByRole('heading', { name: 'Your order' })).toBeInTheDocument();
    expect(screen.getByText('“less sugar”')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Increase quantity of Masala Chai' }));
    expect(await screen.findByText(/Subtotal · 2 items/)).toBeInTheDocument();
    expect(screen.getAllByText('₹60.00').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Edit note for Masala Chai' }));
    const noteBox = screen.getByRole('textbox', { name: /Special instructions for Masala Chai/ });
    await user.clear(noteBox);
    await user.type(noteBox, 'extra ginger{Enter}');
    expect(await screen.findByText('“extra ginger”')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Decrease quantity of Masala Chai' }));
    await user.click(await screen.findByRole('button', { name: 'Remove Masala Chai' }));
    expect(await screen.findByText('Your order is empty.')).toBeInTheDocument();
  });

  test('Back from the cart returns to the menu, including after a reload on the cart page', async () => {
    const user = userEvent.setup();
    const first = await visit();
    await addToCart(user, 'Masala Chai');
    await openCart(user);
    await user.click(await screen.findByRole('button', { name: 'Back to menu' }));
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(await screen.findByRole('heading', { name: 'Chai Point Cafe' })).toBeInTheDocument();
    first.unmount();

    // Reload while on #cart: no history entry of ours to go back to.
    window.history.replaceState(null, '', `/t/${tokens.T1}#cart`);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Back to menu' }));
    expect(await screen.findByRole('heading', { name: 'Chai Point Cafe' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  test('the cart survives a page refresh', async () => {
    const user = userEvent.setup();
    const first = await visit();
    await addToCart(user, 'Filter Coffee');
    first.unmount();

    render(<App />);
    expect(await screen.findByRole('button', { name: /View order · 1 item/ })).toBeInTheDocument();
  });

  test('two guests at one table keep separate carts', async () => {
    const user = userEvent.setup();
    const one = await visit('T3');
    await addToCart(user, 'Masala Chai');
    one.unmount();

    localStorage.clear(); // a second phone: no saved session
    await visit('T3');
    expect(screen.queryByRole('button', { name: /^View order/ })).not.toBeInTheDocument();
  });

  test('an expired session says so, clears the cart and keeps working', async () => {
    const user = userEvent.setup();
    await visit();
    await addToCart(user, 'Masala Chai');

    const { id } = JSON.parse(localStorage.getItem(`petuk.session.${tokens.T1}`));
    await sql("update guest_sessions set expires_at = now() - interval '1 minute' where id = $1", [id]);

    await addToCart(user, 'Filter Coffee').catch(() => {}); // the sheet closes even though the session was lost
    expect(await screen.findByText(/Your session expired, so your cart was cleared/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View order/ })).not.toBeInTheDocument();

    await addToCart(user, 'Filter Coffee'); // a fresh session works straight away
    expect(await screen.findByRole('button', { name: /View order · 1 item/ })).toBeInTheDocument();
  });
});

describe('placing an order', () => {
  test('shows the confirmation, offers the bill, and lets you order again', async () => {
    const user = userEvent.setup();
    await visit();
    expect(screen.queryByRole('button', { name: 'Your bill' })).not.toBeInTheDocument(); // nothing ordered yet
    await addToCart(user, 'Masala Chai', { extra: 1, note: 'less sugar' });
    await openCart(user);

    const before = await orderCount();
    await user.click(await screen.findByRole('button', { name: /^Place order/ }));

    expect(await screen.findByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();
    const [{ order_number }] = await sql('select order_number from orders order by placed_at desc limit 1');
    expect(screen.getByText(`#${order_number}`)).toBeInTheDocument();
    expect(screen.getByText(/pay at the counter/i)).toBeInTheDocument();
    expect(screen.getByText(/2 × Masala Chai/)).toBeInTheDocument();
    expect(await orderCount()).toBe(before + 1);

    await user.click(screen.getByRole('button', { name: 'View bill' }));
    expect(await screen.findByRole('heading', { name: 'Your bill' })).toBeInTheDocument();
    expect(await screen.findByText(`Order #${order_number}`)).toBeInTheDocument();
    expect(screen.getByText(/2 × Masala Chai/)).toBeInTheDocument();
    expect(screen.getByText(/“less sugar”/)).toBeInTheDocument();
    expect(screen.getByText('Total to pay').nextSibling).toHaveTextContent('₹60.00');

    await user.click(screen.getByRole('button', { name: 'Back' })); // back to the confirmation
    expect(await screen.findByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Order something else' }));
    expect(await screen.findByRole('heading', { name: 'Chai Point Cafe' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View order/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Your bill' })).toBeInTheDocument(); // the order is still one tap away
  });

  test('a double-tap on Place order makes one order', async () => {
    const user = userEvent.setup();
    await visit();
    await addToCart(user, 'Samosa (2 pcs)');
    await openCart(user);

    const before = await orderCount();
    await user.dblClick(await screen.findByRole('button', { name: /^Place order/ }));
    await screen.findByRole('heading', { name: 'Order placed!' });
    expect(await orderCount()).toBe(before + 1);
  });

  test('if the reply is lost on a bad connection, trying again does not order twice', async () => {
    const user = userEvent.setup();
    await visit();
    await addToCart(user, 'Maggi Masala');
    await openCart(user);

    // The server receives and processes the order, but the phone never hears back.
    let dropped = false;
    fetchImpl = async (input, init) => {
      const res = await realFetch(new URL(input, base), init);
      if (!dropped && init?.method === 'POST' && String(input).endsWith('/orders')) {
        dropped = true;
        throw new TypeError('network dropped');
      }
      return res;
    };

    const before = await orderCount();
    await user.click(await screen.findByRole('button', { name: /^Place order/ }));
    expect(await screen.findByText(/may not have gone through/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Order placed!' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Place order/ }));
    expect(await screen.findByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();
    expect(await orderCount()).toBe(before + 1);
  });

  test('items that sold out since they were added are flagged, removable, and never ordered', async () => {
    const user = userEvent.setup();
    await visit();
    await addToCart(user, 'Masala Chai');
    await addToCart(user, 'Chocolate Brownie');
    await openCart(user);
    await screen.findByRole('heading', { name: 'Your order' });

    await sql("update menu_items set is_available = false where name = 'Chocolate Brownie'");
    try {
      const before = await orderCount();
      await user.click(screen.getByRole('button', { name: /^Place order/ }));

      expect(await screen.findByText(/Some items just sold out/)).toBeInTheDocument();
      expect(screen.getByText(/No longer available:/).closest('p')).toHaveTextContent('Chocolate Brownie');
      expect(screen.getByRole('button', { name: /^Place order/ })).toBeDisabled();
      expect(await orderCount()).toBe(before);

      await user.click(screen.getByRole('button', { name: 'Remove from my order' }));
      await waitFor(() => expect(screen.queryByText(/No longer available:/)).not.toBeInTheDocument());
      expect(screen.getByText('Masala Chai')).toBeInTheDocument();
      expect(screen.queryByText('Chocolate Brownie')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^Place order/ }));
      expect(await screen.findByRole('heading', { name: 'Order placed!' })).toBeInTheDocument();
      expect(screen.queryByText(/Chocolate Brownie/)).not.toBeInTheDocument();
      expect(await orderCount()).toBe(before + 1);
    } finally {
      await sql("update menu_items set is_available = true where name = 'Chocolate Brownie'");
    }
  });
});

describe('the bill', () => {
  async function placeViaUi(user, itemName, options) {
    await addToCart(user, itemName, options);
    await openCart(user);
    await user.click(await screen.findByRole('button', { name: /^Place order/ }));
    await screen.findByRole('heading', { name: 'Order placed!' });
    return (await sql('select order_number from orders order by placed_at desc, order_number desc limit 1'))[0].order_number;
  }

  test('after a refresh it is still one tap away, and adds up every order from this phone', async () => {
    const user = userEvent.setup();
    const first = await visit('T3');
    const one = await placeViaUi(user, 'Masala Chai'); // 30
    await user.click(screen.getByRole('button', { name: 'Order something else' }));
    const two = await placeViaUi(user, 'Filter Coffee', { extra: 1 }); // 2 x 40
    first.unmount();

    render(<App />); // a refresh: the app lands on the menu, not on a stale confirmation
    await user.click(await screen.findByRole('button', { name: 'Your bill' }));

    expect(await screen.findByText(`Order #${one}`)).toBeInTheDocument();
    expect(screen.getByText(`Order #${two}`)).toBeInTheDocument();
    expect(screen.getByText(/2 × Filter Coffee/)).toBeInTheDocument();
    expect(screen.getByText('Total to pay').nextSibling).toHaveTextContent('₹110.00');
    expect(screen.getByText(/at the counter to pay/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Order more' }));
    expect(await screen.findByRole('heading', { name: 'Chai Point Cafe' })).toBeInTheDocument();
  });

  test('a cancelled order is shown but not charged, and Refresh picks up changes from the kitchen', async () => {
    const user = userEvent.setup();
    await visit('T4');
    const kept = await placeViaUi(user, 'Masala Chai'); // 30
    await user.click(screen.getByRole('button', { name: 'Order something else' }));
    const dropped = await placeViaUi(user, 'Butter Chicken Bowl'); // 240
    await user.click(screen.getByRole('button', { name: 'View bill' }));

    expect(await screen.findByText(`Order #${dropped}`)).toBeInTheDocument();
    expect(screen.getByText('Total to pay').nextSibling).toHaveTextContent('₹270.00');
    expect(screen.queryByText(/Cancelled/)).not.toBeInTheDocument();

    await sql("update orders set status = 'cancelled' where order_number = $1", [dropped]); // the kitchen cancels it
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText(/Cancelled · not charged/)).toBeInTheDocument();
    expect(screen.getByText(`Order #${kept}`)).toBeInTheDocument();
    expect(screen.getByText('Total to pay').nextSibling).toHaveTextContent('₹30.00');
  });

  test('a guest who has not ordered has no bill button, even if someone else at the table has', async () => {
    const user = userEvent.setup();
    const hungry = await visit('T2');
    await placeViaUi(user, 'Masala Chai');
    hungry.unmount();

    localStorage.clear(); // a different phone at the same table
    await visit('T2');
    expect(screen.queryByRole('button', { name: 'Your bill' })).not.toBeInTheDocument();
  });

  test('if the bill cannot be loaded, it says so instead of showing an empty bill', async () => {
    const user = userEvent.setup();
    await visit('T1');
    await placeViaUi(user, 'Masala Chai');
    await user.click(screen.getByRole('button', { name: 'Order something else' }));

    fetchImpl = async () => {
      throw new TypeError('offline');
    };
    await user.click(screen.getByRole('button', { name: 'Your bill' }));
    expect(await screen.findByText(/Can't reach the server/)).toBeInTheDocument();
    expect(screen.queryByText('Total to pay')).not.toBeInTheDocument();
  });
});
