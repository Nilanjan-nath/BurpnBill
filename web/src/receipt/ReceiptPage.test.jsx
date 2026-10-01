import { describe, test, expect, beforeAll, beforeEach, vi, inject } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import App, { receiptTokenFromPath } from '../App.jsx';

// The public receipt page against the real API and a real Postgres (see
// test/globalSetup.js): a bill is made the way the till makes one, then opened
// the way a customer's phone would, from the token in the QR code.

const base = inject('apiBase');
const OWNER = inject('staffUserId');
const realFetch = globalThis.fetch;
let fetchImpl;

beforeAll(() => {
  vi.stubGlobal('fetch', (input, init) => fetchImpl(input, init));
});
beforeEach(() => {
  fetchImpl = (input, init) => realFetch(new URL(input, base), init);
});

async function call(method, path, body) {
  const res = await realFetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer valid-${OWNER}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// A settled bill for two Masala Chai, made through the staff API.
async function settledBill() {
  const tables = (await call('GET', '/api/tables')).body.tables;
  const table = (await call('POST', '/api/tables', { label: `RP${Date.now() % 100000}`, seats: 2 })).body.table ?? tables[0];
  const items = (await call('GET', '/api/items')).body.items;
  const chai = items.find((i) => i.name === 'Masala Chai');
  await call('POST', '/api/staff/orders', { table_id: table.id, items: [{ menu_item_id: chai.id, quantity: 2 }] });
  const done = await call('POST', `/api/tables/${table.id}/checkout`, { method: 'upi', idempotency_key: `rp-${Date.now()}-${Math.random()}` });
  expect(done.status).toBe(200);
  return done.body.bill;
}

describe('the public receipt page', () => {
  test('the address /r/<token> is recognised, and /t/<token> is not mistaken for it', () => {
    expect(receiptTokenFromPath('/r/abc123')).toBe('abc123');
    expect(receiptTokenFromPath('/r/abc123/')).toBe('abc123');
    expect(receiptTokenFromPath('/r/')).toBeNull();
    expect(receiptTokenFromPath('/t/abc123')).toBeNull();
    expect(receiptTokenFromPath('/r/a/b')).toBeNull();
  });

  test('a customer opens their receipt from the token: the bill as printed, read-only, no code of its own', async () => {
    const bill = await settledBill();
    window.history.replaceState(null, '', `/r/${bill.public_token}`);
    render(<App />);

    expect(await screen.findByRole('heading', { name: bill.restaurant_name })).toBeInTheDocument();
    expect(screen.getByText('Bill No.').closest('div')).toHaveTextContent(String(bill.bill_number).padStart(4, '0'));
    expect(screen.getByText('Masala Chai')).toBeInTheDocument();
    expect(screen.getByText('Total').closest('div')).toHaveTextContent('₹60.00');
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeInTheDocument();
    // The page is the digital receipt: it does not offer a code for itself.
    expect(screen.queryByAltText('Scan for digital receipt')).not.toBeInTheDocument();
    // And it asks not to be indexed.
    expect(document.head.querySelector('meta[name="robots"]')?.content).toMatch(/noindex/);
    expect(document.title).toMatch(/^Receipt \d{4} — /);
  });

  test('an unknown token says so plainly instead of showing anything', async () => {
    window.history.replaceState(null, '', `/r/${'0'.repeat(32)}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: "We can't find that receipt" })).toBeInTheDocument();
  });

  test('when the server cannot be reached it says so, and offers nothing else', async () => {
    fetchImpl = () => Promise.reject(new TypeError('offline'));
    window.history.replaceState(null, '', `/r/${'a'.repeat(32)}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: "Couldn't load the receipt" })).toBeInTheDocument();
  });
});
