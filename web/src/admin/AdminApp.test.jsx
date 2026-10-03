import { describe, test, expect, beforeAll, beforeEach, afterEach, vi, inject } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminApp from './AdminApp.jsx';
import { reportCsv, shiftMonth } from './MonthlyReport.jsx';

// The real admin screens -> the real Express API -> a real Postgres (see
// ../test/globalSetup.js). Only the Supabase Auth CLIENT is faked: a token is
// "valid-<user id>", the one convention both sides share.

const base = inject('apiBase');
const ADMIN = inject('platformAdminId');
const CAFE_OWNER = inject('staffUserId'); // 'Mita', owner of Chai Point Cafe: not a platform admin
const CAFE = '11111111-1111-1111-1111-111111111111';
const realFetch = globalThis.fetch;

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

beforeAll(() => {
  vi.stubGlobal('fetch', (input, init) => realFetch(new URL(input, base), init));
});

// Every test leaves the database as it found it: other test files share it.
beforeEach(async () => {
  await sql(`alter table subscription_payments alter column invoice_seq restart with 1`);
});
afterEach(async () => {
  await sql(`delete from subscription_events`);
  await sql(`delete from subscription_payments`);
  await sql(`delete from bills where idempotency_key like 'admintest%'`);
  await sql(`delete from order_status_events where order_id in (select id from orders where total_amount in (111, 222, 333))`);
  await sql(`delete from orders where total_amount in (111, 222, 333)`);
  await sql(`update restaurants set trial_ends_at = now() + interval '10 days', paid_until = null where id = $1`, [CAFE]);
});

// Signs in as `userId` through the fake client, then lands on whatever the app shows.
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
        if (email !== 'admin@example.com' || password !== 'secret') return { data: {}, error: { message: 'Invalid login credentials' } };
        session = { access_token: `valid-${userId}`, user: { id: userId, email } };
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

async function openAdmin(user, as = ADMIN) {
  render(<AdminApp auth={createFakeAuth(as)} />);
  await screen.findByRole('heading', { name: 'Staff sign in' });
  await user.type(screen.getByLabelText('Email'), 'admin@example.com');
  await user.type(screen.getByLabelText('Password'), 'secret');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function seedOrder(source, total) {
  await sql(
    `with t as (select id from restaurant_tables where restaurant_id = $1 limit 1),
          s as (insert into guest_sessions (restaurant_id, table_id, expires_at)
                select $1, t.id, now() + interval '3 hours' from t returning id, table_id)
     insert into orders (restaurant_id, table_id, guest_session_id, status, subtotal, total_amount, approved_at, source)
     select $1, s.table_id, s.id, 'served', $2, $2, now(), $3::order_source from s`,
    [CAFE, total, source],
  );
}
async function seedBill(total, key) {
  await sql(
    `insert into bills (restaurant_id, bill_number, idempotency_key, table_label, restaurant_name, currency_code, payment_method, subtotal, total_amount)
     values ($1, (select coalesce(max(bill_number), 0) + 1000 from bills where restaurant_id = $1), $2, 'T1', 'Cafe', 'INR', 'cash', $3, $3)`,
    [CAFE, key, total],
  );
}

// Other test files share this database and leave orders in the same café, so the
// report is checked against what was already there: baseline + what this test adds.
async function monthSoFar() {
  const month = `(to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM') || '-01')::timestamp at time zone 'Asia/Kolkata'`;
  const [o] = await sql(
    `select count(*) filter (where source = 'qr')::int as qr,
            count(*) filter (where source = 'pos')::int as pos,
            coalesce(sum(total_amount), 0)::float as value
       from orders
      where restaurant_id = $1 and approved_at is not null and status <> 'cancelled' and placed_at >= ${month}`,
    [CAFE],
  );
  const [b] = await sql(`select coalesce(sum(total_amount), 0)::float as sales from bills where restaurant_id = $1 and settled_at >= ${month}`, [CAFE]);
  return { ...o, sales: b.sales };
}
const rupees = (text) => Number(text.replace(/[^0-9.]/g, ''));

describe('who gets in', () => {
  test('a café owner who is not a platform admin sees a refusal and no figures', async () => {
    const user = userEvent.setup();
    await openAdmin(user, CAFE_OWNER);

    expect(await screen.findByRole('heading', { name: 'Not allowed' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByText('Received this month')).not.toBeInTheDocument();
  });

  test('a wrong password stays on the sign-in form', async () => {
    const user = userEvent.setup();
    render(<AdminApp auth={createFakeAuth(ADMIN)} />);
    await screen.findByRole('heading', { name: 'Staff sign in' });
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  });
});

describe('overview and cafés', () => {
  test('the overview counts cafés by plan and the café list shows the plan and activity', async () => {
    const user = userEvent.setup();
    await sql(`update restaurants set trial_ends_at = now() - interval '1 day' where id = $1`, [CAFE]); // day 15: grace
    await openAdmin(user);

    const tiles = await screen.findByRole('region', { name: 'Cafés by plan' });
    expect(within(tiles).getByText('In grace').nextSibling).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Cafés' }));
    const list = await screen.findByRole('list', { name: 'Cafés' });
    const row = within(list).getByRole('button', { name: /Chai Point Cafe/ });
    expect(within(row).getByText('Grace')).toBeInTheDocument();
    expect(row.querySelector('[data-plan-state="grace"]')).not.toBeNull();
  });
});

describe('the monthly report', () => {
  test('QR and POS orders, money taken and order value per café, and a total', async () => {
    const user = userEvent.setup();
    const before = await monthSoFar();
    await seedOrder('qr', 111);
    await seedOrder('qr', 222);
    await seedOrder('pos', 333);
    await seedBill(500, 'admintest-1');
    await openAdmin(user);
    await user.click(await screen.findByRole('button', { name: 'Monthly report' }));

    const table = await screen.findByRole('table', { name: /Report for/ });
    const row = within(table).getByRole('row', { name: /Chai Point Cafe/ });
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(Number(cells[0])).toBe(before.qr + 2); // QR orders
    expect(Number(cells[1])).toBe(before.pos + 1); // POS orders
    expect(rupees(cells[2])).toBe(before.value + 666); // order value 111 + 222 + 333
    expect(rupees(cells[3])).toBe(before.sales + 500); // money taken: the bill, not the orders
    // The total row covers every café; the demo café is the only one with activity here.
    const total = within(table).getByRole('row', { name: /All cafés/ });
    expect(rupees(within(total).getAllByRole('cell')[3].textContent)).toBeGreaterThanOrEqual(before.sales + 500);
  });

  test('the month buttons move to last month, where nothing happened yet', async () => {
    const user = userEvent.setup();
    await seedOrder('qr', 111);
    await openAdmin(user);
    await user.click(await screen.findByRole('button', { name: 'Monthly report' }));

    const heading = await screen.findByRole('heading', { level: 2 });
    const thisMonth = heading.textContent;
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(thisMonth));
    const table = await screen.findByRole('table', { name: /Report for/ });
    // Last month has none of this test's orders: the row exists and says so in numbers, not as an error.
    expect(within(within(table).getByRole('row', { name: /Chai Point Cafe/ })).getAllByRole('cell')[0].textContent).toMatch(/^\d+$/);
  });

  test('the CSV carries the same figures, with commas and quotes in a café name kept intact', () => {
    const report = {
      month: '2026-10',
      cafes: [
        {
          name: 'Tea, "Toast" & Co', qr_orders: 2, pos_orders: 1, orders: 3, order_value: '350.00', sales: '450.50',
          average_order: '116.67', cancelled: 2, previous: { sales: '40.00' }, change: { sales: 1026.3 }, last_order_at: null,
        },
      ],
      totals: { cafes: 1, qr_orders: 2, pos_orders: 1, orders: 3, order_value: '350.00', sales: '450.50', average_order: '116.67', cancelled: 2, previous: { sales: '40.00' }, change: { sales: 1026.3 } },
    };
    const [head, row, total] = reportCsv(report).split('\n');
    expect(head).toContain('Sales (money taken)');
    expect(row.startsWith('"Tea, ""Toast"" & Co",2,1,3,350.00,450.50')).toBe(true);
    expect(total.startsWith('All cafés,2,1,3,350.00,450.50')).toBe(true);
  });

  test('month arithmetic crosses a year without a Date', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });
});

describe('recording a payment', () => {
  const openCafe = async (user) => {
    await openAdmin(user);
    await user.click(await screen.findByRole('button', { name: 'Cafés' }));
    await user.click(await screen.findByRole('button', { name: /Chai Point Cafe/ }));
    await screen.findByRole('heading', { name: 'Chai Point Cafe' });
  };

  test('record a payment, see the plan extend, and open its invoice', async () => {
    const user = userEvent.setup();
    await openCafe(user);

    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog', { name: /Record a payment from Chai Point Cafe/ });
    expect(within(dialog).getByLabelText(/Amount received/)).toHaveValue('1499.00'); // the plan's price
    expect(within(dialog).getByLabelText(/Months covered/)).toHaveValue(6);
    await user.type(within(dialog).getByLabelText(/Reference/), 'UTR-ADMIN-1');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    expect(await within(dialog).findByRole('status')).toHaveTextContent(/Recorded as BNB-0001/);
    const [saved] = await sql(`select amount, method, reference, period_end > now() + interval '5 months' as long_plan from subscription_payments`);
    expect(saved).toEqual({ amount: '1499.00', method: 'upi', reference: 'UTR-ADMIN-1', long_plan: true });
    const [cafe] = await sql(`select paid_until is not null as paid from restaurants where id = $1`, [CAFE]);
    expect(cafe.paid).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: 'Open the invoice' }));
    const invoice = await screen.findByRole('dialog', { name: 'Invoice' });
    expect(await within(invoice).findByRole('article', { name: 'Invoice BNB-0001' })).toBeInTheDocument();
    expect(within(invoice).getByText('BurpnBill plan, 6 months')).toBeInTheDocument();
    expect(within(invoice).getAllByText(/1,499\.00/).length).toBeGreaterThan(0);
    expect(within(invoice).getByText(/reference UTR-ADMIN-1/)).toBeInTheDocument();
  });

  test('the same reference twice is refused with the server\'s explanation, and nothing is recorded twice', async () => {
    const user = userEvent.setup();
    await sql(
      `insert into subscription_payments (restaurant_id, amount, method, reference, period_start, period_end, snapshot)
       values ($1, 1499, 'upi', 'DUP-9', now(), now() + interval '6 months', '{"restaurant":{"name":"x"},"seller":{"name":"y"}}')`,
      [CAFE],
    );
    await openCafe(user);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog', { name: /Record a payment/ });
    await user.type(within(dialog).getByLabelText(/Reference/), 'dup-9');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already recorded/i);
    const [{ n }] = await sql(`select count(*)::int as n from subscription_payments`);
    expect(n).toBe(1);
  });

  test('extending the trial says so, and the café\'s end date moves', async () => {
    const user = userEvent.setup();
    await openCafe(user);
    const [before] = await sql(`select extract(epoch from trial_ends_at)::bigint as t from restaurants where id = $1`, [CAFE]);

    await user.selectOptions(screen.getByLabelText('Extend the trial by'), '14');
    await user.click(screen.getByRole('button', { name: 'Extend trial' }));
    expect(await screen.findByText('Trial extended.')).toBeInTheDocument();

    const [after] = await sql(`select extract(epoch from trial_ends_at)::bigint as t from restaurants where id = $1`, [CAFE]);
    expect(Number(after.t) - Number(before.t)).toBe(14 * 86400);
  });
});
