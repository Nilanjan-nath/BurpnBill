import { describe, test, expect, beforeAll, beforeEach, afterEach, vi, inject } from 'vitest';
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
    for (const category of ['Beverages', 'Snacks', 'Mains', 'Desserts']) {
      expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
    }
    const chai = screen.getByText('Masala Chai').closest('li');
    expect(within(chai).getByText('₹30.00')).toBeInTheDocument();
    expect(within(chai).getByRole('img', { name: 'Vegetarian' })).toBeInTheDocument();
    const puff = screen.getByText('Chicken Puff').closest('li');
    expect(within(puff).getByRole('img', { name: 'Non-vegetarian' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View order/ })).not.toBeInTheDocument();
  });

  test('categories read in the order the owner set, not alphabetically', async () => {
    await visit('T2');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    // display_order on menu_categories. Alphabetically this would be
    // Beverages, Desserts, Mains, Snacks.
    expect(headings).toEqual(['Beverages', 'Snacks', 'Mains', 'Desserts']);
  });

  test("an item's photo is shown when the owner has uploaded one, and nothing breaks when they haven't", async () => {
    await sql("update menu_items set image_url = 'https://storage.test/storage/v1/object/public/menu-images/chai.png' where name = 'Masala Chai'");
    try {
      await visit('T2');
      const chai = screen.getByText('Masala Chai').closest('li');
      const photo = within(chai).getByRole('presentation');
      expect(photo.getAttribute('src')).toContain('menu-images/chai.png');
      // Decorative: the dish name sits right beside it, so a screen reader
      // repeating it would be noise.
      expect(photo).toHaveAttribute('alt', '');

      const withoutPhoto = screen.getByText('Filter Coffee').closest('li');
      expect(withoutPhoto.querySelector('img')).toBeNull();
      expect(within(withoutPhoto).getByText('₹40.00')).toBeInTheDocument();
    } finally {
      await sql("update menu_items set image_url = null where name = 'Masala Chai'");
    }
  });

  test('an item with no photo gets a placeholder in the same square, not a gap', async () => {
    await visit('T2');
    const row = screen.getByText('Filter Coffee').closest('li');
    // Decorative and not an <img>: nothing for a screen reader to announce or a
    // broken-image icon to appear in, and the row keeps its thumbnail column.
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('div[aria-hidden="true"] svg')).not.toBeNull();
  });

  test('search narrows the list by name or description, and says so when nothing matches', async () => {
    const user = userEvent.setup();
    await visit('T2');
    await user.type(screen.getByRole('searchbox', { name: 'Search the menu' }), 'chicken');
    // "Chicken Puff" by name; "Butter Chicken Bowl" by name; "Cold Coffee"'s
    // description never mentions it.
    expect(screen.getByText('Chicken Puff')).toBeInTheDocument();
    expect(screen.getByText('Butter Chicken Bowl')).toBeInTheDocument();
    expect(screen.queryByText('Masala Chai')).not.toBeInTheDocument();
    // A section left with nothing in it disappears rather than sitting empty.
    expect(screen.queryByRole('heading', { name: 'Beverages' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'served warm'); // Brownie's description
    expect(screen.getByText('Chocolate Brownie')).toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('Nothing matches that.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Clear search and filters/ }));
    expect(screen.getByText('Masala Chai')).toBeInTheDocument();
  });

  test('the veg filter shows only what is marked vegetarian, and non-veg only what is marked otherwise', async () => {
    const user = userEvent.setup();
    await visit('T2');
    await user.click(screen.getByRole('button', { name: 'Filter by veg or non-veg' }));

    await user.click(screen.getByRole('button', { name: 'Non-veg' }));
    expect(screen.getByText('Chicken Puff')).toBeInTheDocument();
    expect(screen.getByText('Butter Chicken Bowl')).toBeInTheDocument();
    expect(screen.queryByText('Masala Chai')).not.toBeInTheDocument();
    expect(screen.queryByText('Veg Sandwich')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Veg' }));
    expect(screen.getByText('Veg Sandwich')).toBeInTheDocument();
    expect(screen.queryByText('Chicken Puff')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Any' }));
    expect(screen.getByText('Chicken Puff')).toBeInTheDocument();
  });

  test('a category tab shows that section alone, and All brings the rest back', async () => {
    const user = userEvent.setup();
    await visit('T2');
    const tabs = within(screen.getByRole('navigation', { name: 'Menu categories' }));
    await user.click(tabs.getByRole('button', { name: 'Desserts' }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Desserts']);
    expect(tabs.getByRole('button', { name: 'Desserts' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Masala Chai')).not.toBeInTheDocument();

    // A tab and a search work together: Desserts, but only what matches.
    await user.type(screen.getByRole('searchbox'), 'chai');
    expect(screen.getByText('Nothing matches that.')).toBeInTheDocument();

    // Clearing has to lift the tab too — otherwise "clear" leaves you on a
    // section the search alone never chose.
    await user.click(screen.getByRole('button', { name: /Clear search and filters/ }));
    expect(screen.getByText('Masala Chai')).toBeInTheDocument();
    expect(tabs.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
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

  });
});

describe('the landing page', () => {
  // The bare address is where a café owner arrives; a customer arrives at
  // /t/<token> with their camera. So / is the landing page now.
  const openLanding = async () => {
    window.history.replaceState(null, '', '/');
    render(<App />);
    return screen.findByRole('heading', { level: 1, name: /Order fast\. Settle easy\./i });
  };

  test('/ is the landing page, and every link on it goes somewhere real', async () => {
    await openLanding();

    // Both CTAs and the sign-in link land on the one place a café owner can
    // actually start: the staff app, which offers to create a café.
    expect(screen.getAllByRole('link', { name: /Start free/ })[0]).toHaveAttribute('href', '/staff');
    expect(screen.getAllByRole('link', { name: /Create your café/ })[0]).toHaveAttribute('href', '/staff');
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0]).toHaveAttribute('href', '/staff');

    // Every in-page anchor has something to scroll to. A nav link that points
    // at a section nobody added is the "button does nothing" bug.
    const anchors = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((href) => href.startsWith('#'));
    expect(anchors.length).toBeGreaterThan(3);
    for (const href of anchors) {
      expect(document.querySelector(href), `${href} has no target`).not.toBeNull();
    }
  });

  test('it leads with the operational problem, and shows the product doing the work', async () => {
    await openLanding();

    expect(screen.getByText(/nobody could get to table nine/i)).toBeInTheDocument();
    // The counter's approval is what makes this product not naive, so it is on
    // the page rather than discovered after signing up.
    expect(screen.getByRole('heading', { name: /Nothing reaches the kitchen until you accept it/ })).toBeInTheDocument();
    // The software is the hero visual: the board mockup carries real columns.
    expect(screen.getAllByText('Preparing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
  });

  test('it sells the whole product, not just the QR half', async () => {
    await openLanding();

    // The first version of this page read as if BurpnBill were only a QR menu. It
    // is also the till, the floor plan and the day's numbers, and each of those
    // is a reason an owner would choose it — so each is named here.
    expect(screen.getByRole('heading', { name: /no QR code needed/i })).toBeInTheDocument();
    expect(screen.getByText(/Ring up a walk-in without a QR code/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Arrange the room the way it actually is/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /when you were busy/ })).toBeInTheDocument();
    expect(screen.getByText(/Sales by hour, so you can staff the rush/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Staff accounts and roles' })).toBeInTheDocument();

    // And each is SHOWN, not just claimed — the mockups are the argument, so
    // assert the ones that carry these three, by their own content.
    expect(screen.getAllByText('POS').length).toBeGreaterThan(0);
    expect(screen.getByText('Send to kitchen')).toBeInTheDocument(); // POS order entry
    expect(screen.getByText(/Settings · Seating plan/)).toBeInTheDocument(); // the floor plan
    expect(screen.getByText('Taken today')).toBeInTheDocument(); // the dashboard
    expect(screen.getByText('Sales by hour')).toBeInTheDocument();
  });

  test('it promises nothing the product does not have', async () => {
    await openLanding();

    // There is one café live, zero years behind us and no error metric. A
    // landing page is the easiest place in this product to claim otherwise, so
    // it is asserted here rather than left to whoever edits the copy next.
    const page = document.body.textContent;
    expect(page).not.toMatch(/trusted by \d/i);
    expect(page).not.toMatch(/\d[\d,]*\+\s*(cafés|cafes|restaurants|businesses)/i);
    expect(page).not.toMatch(/no credit card|money.back guarantee|cancel anytime|lifetime/i);
    expect(page).not.toMatch(/uptime|99\.\d\s*%/i);
    // Order status is polled and only as current as the kitchen's taps, and there
    // is no estimate anywhere in the product — so the page may not say otherwise.
    expect(page).not.toMatch(/real.?time|instant(ly)? (update|notif)|push notification/i);
    expect(page).not.toMatch(/estimated (time|wait)|\bETA\b|ready in \d|exactly when/i);

    // What it says instead is true, and checkable: 14 days free, and it says out
    // loud that no price is set. There is no subscription yet, so the pricing
    // section must not carry an amount or a billing period — that would be a
    // price nobody has decided.
    expect(screen.getAllByText(/Free for 14 days/i).length).toBeGreaterThan(0);
    expect(page).not.toMatch(/while we.re in beta/i);
    const pricing = document.getElementById('pricing');
    expect(pricing).toHaveTextContent(/haven.t set a price yet/i);
    expect(pricing.textContent).not.toMatch(/₹\s*\d|\$\s*\d|per month|\/\s*mo\b|per year|billed/i);
    // The order-status card says what it does, including that the café decides
    // what "ready" means — it is not a promise of delivery.
    const status = screen.getByRole('heading', { name: 'Customers see where their order is' }).closest('div');
    expect(status).toHaveTextContent(/being prepared/);
    expect(status).toHaveTextContent(/brought to the table or collected at the counter/);
    expect(screen.getByRole('heading', { name: 'No payment gateway' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No tax engine' })).toBeInTheDocument();
  });

  test('a customer who lands here by mistake still gets told what to do', async () => {
    await openLanding();
    // This page took over the address that used to carry that line.
    expect(screen.getByText(/Point your phone.s camera at the QR code on your table/)).toBeInTheDocument();
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

    const { id } = JSON.parse(localStorage.getItem(`burpnbill.session.${tokens.T1}`));
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

describe('order status', () => {
  // These tests place orders and move them along, and every web test file shares
  // one database. An approved, unpaid order left on T4 is exactly what a later
  // POS test then finds on its bill, which made "a table that ordered twice
  // checks out as one merged bill" fail — but only when this file ran first.
  // So each test removes whatever it placed.
  let firstNewOrder;
  beforeEach(async () => {
    firstNewOrder = Number((await sql('select coalesce(max(order_number), 0) n from orders'))[0].n) + 1;
  });
  afterEach(async () => {
    await sql('delete from orders where order_number >= $1', [firstNewOrder]);
  });

  async function orderAndWait(user, table = 'T2', item = 'Masala Chai') {
    await visit(table);
    await addToCart(user, item);
    await openCart(user);
    await user.click(await screen.findByRole('button', { name: /^Place order/ }));
    await screen.findByRole('heading', { name: 'Order placed!' });
    return (await sql('select id, order_number from orders order by placed_at desc, order_number desc limit 1'))[0];
  }
  const advance = (id, sqlText) => sql(sqlText, [id]);

  test('the confirmation tells the truth at each stage, and Refresh brings the change in', async () => {
    const user = userEvent.setup();
    const order = await orderAndWait(user);

    // Not "the kitchen has your order": it is waiting for the counter.
    expect(await screen.findByText('Waiting for the counter to accept your order')).toBeInTheDocument();
    expect(screen.queryByText(/kitchen has your order/i)).not.toBeInTheDocument();

    await advance(order.id, 'update orders set approved_at = now() where id = $1');
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByText('Accepted — the kitchen will start soon')).toBeInTheDocument();

    await advance(order.id, "update orders set status = 'preparing' where id = $1");
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByText('Being prepared')).toBeInTheDocument();

    await advance(order.id, "update orders set status = 'ready' where id = $1");
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));
    // The default café brings food to the table.
    expect(await screen.findByText('Ready — on its way to your table')).toBeInTheDocument();
  });

  test('"ready" says collect it at the counter in a self-service café — never promises a delivery', async () => {
    await sql("update restaurants set service_mode = 'counter'");
    try {
      const user = userEvent.setup();
      const order = await orderAndWait(user, 'T3');
      await advance(order.id, 'update orders set approved_at = now() where id = $1');
      await advance(order.id, "update orders set status = 'preparing' where id = $1");
      await advance(order.id, "update orders set status = 'ready' where id = $1");
      await user.click(screen.getByRole('button', { name: 'Refresh status' }));

      expect(await screen.findByText('Ready — please collect it from the counter')).toBeInTheDocument();
      expect(screen.queryByText(/on its way/i)).not.toBeInTheDocument();
    } finally {
      await sql("update restaurants set service_mode = 'table'");
    }
  });

  test('an order the counter turned away says so instead of staying "waiting"', async () => {
    const user = userEvent.setup();
    const order = await orderAndWait(user);
    await advance(order.id, "update orders set status = 'cancelled' where id = $1");
    await user.click(screen.getByRole('button', { name: 'Refresh status' }));

    expect(await screen.findByText(/^Cancelled — please ask at the counter/)).toBeInTheDocument();
    expect(screen.queryByText('Waiting for the counter to accept your order')).not.toBeInTheDocument();
  });

  test('the bill shows each order\'s status, and leaves a cancelled one to its "not charged" badge', async () => {
    const user = userEvent.setup();
    const first = await orderAndWait(user, 'T4', 'Masala Chai');
    await advance(first.id, 'update orders set approved_at = now() where id = $1');
    await advance(first.id, "update orders set status = 'preparing' where id = $1");
    await user.click(screen.getByRole('button', { name: 'Order something else' }));
    await addToCart(user, 'Filter Coffee');
    await openCart(user);
    await user.click(await screen.findByRole('button', { name: /^Place order/ }));
    await screen.findByRole('heading', { name: 'Order placed!' });
    const second = (await sql('select id from orders order by placed_at desc, order_number desc limit 1'))[0];
    await advance(second.id, "update orders set status = 'cancelled' where id = $1");

    await user.click(screen.getByRole('button', { name: 'View bill' }));
    await screen.findByText('Total to pay');
    expect(await screen.findByText('Being prepared')).toBeInTheDocument();
    expect(screen.getByText('Cancelled · not charged')).toBeInTheDocument();
    expect(screen.queryByText(/^Cancelled — please ask/)).not.toBeInTheDocument(); // not said twice
  });
});
