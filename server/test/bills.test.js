import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// Bills (docs/TASKS.md Step 14, phase A): settling a table makes one numbered,
// frozen bill. Real Postgres (PGlite) with the repo's migrations and seed.

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KITCHEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RIVAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db;
let server;
let base;
let rivalRestaurantId;

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

  const { rows } = await db.query(`insert into restaurants (name) values ('Rival Cafe') returning id`);
  rivalRestaurantId = rows[0].id;
  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $4, 'owner', 'Mita'), ($2, $4, 'staff', 'Ravi'), ($3, $4, 'kitchen', 'Bikash'), ($5, $6, 'owner', 'Rival')`,
    [OWNER, STAFF, KITCHEN, RESTAURANT_ID, RIVAL, rivalRestaurantId],
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

let seq = 0;
const key = () => `bill-test-key-${Date.now()}-${seq++}`;
async function freshTable() {
  const { rows } = await db.query(
    `insert into restaurant_tables (restaurant_id, label, seats) values ($1, $2, 4) returning id`,
    [RESTAURANT_ID, `BL${seq++}`],
  );
  return rows[0].id;
}
async function itemId(name) {
  const { rows } = await db.query('select id from menu_items where name = $1 and restaurant_id = $2', [name, RESTAURANT_ID]);
  return rows[0].id;
}
// Puts `quantity` of `name` on the table as one staff-placed round.
async function order(table, name, quantity = 1) {
  const res = await call('POST', '/api/staff/orders', {
    as: OWNER,
    body: { table_id: table, items: [{ menu_item_id: await itemId(name), quantity }] },
  });
  assert.equal(res.status, 201);
  return res.body.order;
}
const checkout = (as, table, body = {}) =>
  call('POST', `/api/tables/${table}/checkout`, { as, body: { method: 'cash', idempotency_key: key(), ...body } });

test('settling a table returns a numbered bill with the lines, totals and the café as printed', async () => {
  await db.query(`update restaurants set name = 'Chai Point Cafe', address = '12 MG Road', phone = '98300 00000' where id = $1`, [RESTAURANT_ID]);
  const table = await freshTable();
  await order(table, 'Masala Chai', 2); // 2 x 30.00
  await order(table, 'Veg Sandwich', 1); // 80.00

  const res = await checkout(OWNER, table, { method: 'upi' });
  assert.equal(res.status, 200);
  const bill = res.body.bill;
  assert.ok(bill.bill_number >= 1);
  assert.equal(bill.restaurant_name, 'Chai Point Cafe');
  assert.equal(bill.restaurant_address, '12 MG Road');
  assert.equal(bill.restaurant_phone, '98300 00000');
  assert.equal(bill.payment_method, 'upi');
  assert.equal(bill.total_amount, '140.00');
  assert.equal(bill.subtotal, '140.00');
  assert.equal(bill.tax_amount, '0.00');
  assert.equal(bill.amount_tendered, null, 'tendered is a cash-only field');
  assert.deepEqual(
    bill.lines.map((l) => [l.name, l.quantity, l.unit_price, l.line_total]),
    [
      ['Masala Chai', 2, '30.00', '60.00'],
      ['Veg Sandwich', 1, '80.00', '80.00'],
    ],
  );
  assert.equal(res.body.amount, '140.00');
});

test('bill numbers are consecutive per café, and another café counts from its own 1', async () => {
  const a = await freshTable();
  await order(a, 'Masala Chai');
  const b = await freshTable();
  await order(b, 'Masala Chai');
  const first = (await checkout(OWNER, a)).body.bill.bill_number;
  const second = (await checkout(OWNER, b)).body.bill.bill_number;
  assert.equal(second, first + 1);

  const { rows: rivalTable } = await db.query(
    `insert into restaurant_tables (restaurant_id, label) values ($1, 'R1') returning id`, [rivalRestaurantId]);
  const { rows: rivalItem } = await db.query(
    `insert into menu_items (restaurant_id, name, price) values ($1, 'Rival Tea', 10) returning id`, [rivalRestaurantId]);
  const placed = await call('POST', '/api/staff/orders', {
    as: RIVAL,
    body: { table_id: rivalTable[0].id, items: [{ menu_item_id: rivalItem[0].id, quantity: 1 }] },
  });
  assert.equal(placed.status, 201);
  const theirs = await call('POST', `/api/tables/${rivalTable[0].id}/checkout`, { as: RIVAL, body: { method: 'cash', idempotency_key: key() } });
  assert.equal(theirs.body.bill.bill_number, 1, 'each café has its own sequence');
});

test('a bill is frozen: changing the menu price or the café afterwards does not change a reprint', async () => {
  const table = await freshTable();
  await order(table, 'Filter Coffee'); // 40.00
  const { bill } = (await checkout(OWNER, table)).body;

  await db.query(`update menu_items set price = 999, name = 'Renamed' where name = 'Filter Coffee' and restaurant_id = $1`, [RESTAURANT_ID]);
  await db.query(`update restaurants set name = 'New Name', address = 'Elsewhere' where id = $1`, [RESTAURANT_ID]);

  const again = await call('GET', `/api/bills/${bill.id}`, { as: STAFF });
  assert.equal(again.status, 200);
  assert.equal(again.body.bill.lines[0].name, 'Filter Coffee');
  assert.equal(again.body.bill.lines[0].line_total, '40.00');
  assert.equal(again.body.bill.restaurant_name, 'Chai Point Cafe');
  assert.equal(again.body.bill.total_amount, '40.00');

  await db.query(`update menu_items set price = 40, name = 'Filter Coffee' where name = 'Renamed'`);
  await db.query(`update restaurants set name = 'Chai Point Cafe' where id = $1`, [RESTAURANT_ID]);
});

test('cash tendered is recorded with the change; too little is refused and nothing is settled', async () => {
  const table = await freshTable();
  await order(table, 'Masala Chai', 2); // 60.00

  const short = await checkout(OWNER, table, { amount_tendered: 50 });
  assert.equal(short.status, 400);
  const { rows: unpaid } = await db.query(`select count(*)::int as n from orders where table_id = $1 and paid_at is null`, [table]);
  assert.equal(unpaid[0].n, 1, 'a refused checkout leaves the table unsettled');

  const ok = await checkout(OWNER, table, { amount_tendered: 100 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.bill.amount_tendered, '100.00');
  assert.equal(ok.body.bill.change_given, '40.00');
});

test('card and UPI ignore any amount tendered', async () => {
  const table = await freshTable();
  await order(table, 'Masala Chai');
  const res = await checkout(OWNER, table, { method: 'card', amount_tendered: 500 });
  assert.equal(res.status, 200);
  assert.equal(res.body.bill.amount_tendered, null);
  assert.equal(res.body.bill.change_given, null);
});

test('a replayed checkout returns the same bill and uses no new bill number', async () => {
  const table = await freshTable();
  await order(table, 'Masala Chai');
  const k = key();
  const first = await checkout(OWNER, table, { idempotency_key: k });
  const before = (await db.query('select bill_counter from restaurants where id = $1', [RESTAURANT_ID])).rows[0].bill_counter;
  const replay = await checkout(OWNER, table, { idempotency_key: k });
  const after = (await db.query('select bill_counter from restaurants where id = $1', [RESTAURANT_ID])).rows[0].bill_counter;

  assert.equal(replay.status, 200);
  assert.equal(replay.body.already_settled, true);
  assert.equal(replay.body.bill.id, first.body.bill.id);
  assert.equal(replay.body.bill.bill_number, first.body.bill.bill_number);
  assert.equal(after, before, 'a replay must not burn a bill number');
});

test('two tills confirming the same table at once make one bill, not two', async () => {
  const table = await freshTable();
  await order(table, 'Masala Chai');
  const k = key();
  const [one, two] = await Promise.all([checkout(OWNER, table, { idempotency_key: k }), checkout(STAFF, table, { idempotency_key: k })]);
  assert.deepEqual([one.status, two.status], [200, 200]);
  assert.equal(one.body.bill.id, two.body.bill.id);
  const { rows } = await db.query(`select count(*)::int as n from bills where table_id = $1`, [table]);
  assert.equal(rows[0].n, 1);
});

test('every payment from the checkout points at its bill', async () => {
  const table = await freshTable();
  await order(table, 'Masala Chai');
  await order(table, 'Veg Sandwich');
  const { bill } = (await checkout(OWNER, table)).body;
  const { rows } = await db.query(`select count(*)::int as n, count(bill_id)::int as linked from payments where bill_id = $1`, [bill.id]);
  assert.deepEqual(rows[0], { n: 2, linked: 2 });
  assert.deepEqual([...new Set(bill.lines.map((l) => l.order_number))].length, 2, 'lines carry the round they came from');
});

test('a bill can be fetched by front of house in its own café only', async () => {
  const table = await freshTable();
  await order(table, 'Masala Chai');
  const { bill } = (await checkout(OWNER, table)).body;

  assert.equal((await call('GET', `/api/bills/${bill.id}`)).status, 401);
  assert.equal((await call('GET', `/api/bills/${bill.id}`, { as: KITCHEN })).status, 403);
  assert.equal((await call('GET', `/api/bills/${bill.id}`, { as: STAFF })).status, 200);
  assert.equal((await call('GET', `/api/bills/${bill.id}`, { as: RIVAL })).status, 404, 'another café cannot read it');
  assert.equal((await call('GET', '/api/bills/99999999-9999-4999-8999-999999999999', { as: OWNER })).status, 404);
});

// --- GST on the bill (phase B) --------------------------------------------------

import { splitInclusiveGst } from '../src/services/tables.js';

test('splitting an inclusive total: tax carved out, CGST and SGST add back exactly', () => {
  // 180.00 at 5% -> tax 8.57 (180 * 5 / 105 = 8.5714), taxable 171.43
  assert.deepEqual(splitInclusiveGst('180.00', '5.00'), { tax: '8.57', taxable: '171.43', cgst: '4.29', sgst: '4.28' });
  // Odd paisa goes to CGST; the parts always sum to the total.
  for (const [total, rate] of [['200.00', '5.00'], ['99.99', '12.00'], ['0.01', '5.00'], ['1234.56', '18.00'], ['75.00', '2.50']]) {
    const s = splitInclusiveGst(total, rate);
    const paise = (v) => Math.round(Number(v) * 100);
    assert.equal(paise(s.taxable) + paise(s.cgst) + paise(s.sgst), paise(total), `${total} @ ${rate}`);
    assert.equal(paise(s.cgst) + paise(s.sgst), paise(s.tax));
  }
  assert.deepEqual(splitInclusiveGst('100.00', '0.00'), { tax: '0.00', taxable: '100.00', cgst: '0.00', sgst: '0.00' });
});

test('with GST on, the bill carries the split and the registration numbers, and the total is unchanged', async () => {
  await db.query(
    `update restaurants set gst_enabled = true, gstin = '19ABCDE1234F1Z5', gst_rate = 5, fssai_number = '12345678901234' where id = $1`,
    [RESTAURANT_ID],
  );
  try {
    const table = await freshTable();
    await order(table, 'Masala Chai', 2); // 60.00
    await order(table, 'Veg Sandwich', 1); // 80.00 -> 140.00 inclusive

    const { bill } = (await checkout(OWNER, table)).body;
    assert.equal(bill.total_amount, '140.00', 'inclusive: the customer pays the menu prices');
    assert.equal(bill.tax_rate, '5.00');
    assert.equal(bill.tax_amount, '6.67'); // 140 * 5 / 105 = 6.6667
    assert.equal(bill.taxable_value, '133.33');
    assert.equal(bill.cgst_amount, '3.34');
    assert.equal(bill.sgst_amount, '3.33');
    assert.equal(bill.gstin, '19ABCDE1234F1Z5');
    assert.equal(bill.fssai_number, '12345678901234');

    // Frozen: turning GST off, or changing the rate, does not rewrite a reprint.
    await db.query(`update restaurants set gst_enabled = false, gst_rate = 18 where id = $1`, [RESTAURANT_ID]);
    const again = (await call('GET', `/api/bills/${bill.id}`, { as: OWNER })).body.bill;
    assert.equal(again.tax_rate, '5.00');
    assert.equal(again.cgst_amount, '3.34');
  } finally {
    await db.query(`update restaurants set gst_enabled = false, gstin = null, gst_rate = 5, fssai_number = null where id = $1`, [RESTAURANT_ID]);
  }
});

test('with GST off the bill has no tax split, but still carries an FSSAI number if the café has one', async () => {
  await db.query(`update restaurants set fssai_number = '12345678901234' where id = $1`, [RESTAURANT_ID]);
  try {
    const table = await freshTable();
    await order(table, 'Masala Chai');
    const { bill } = (await checkout(OWNER, table)).body;
    assert.equal(bill.tax_rate, null);
    assert.equal(bill.taxable_value, null);
    assert.equal(bill.gstin, null);
    assert.equal(bill.tax_amount, '0.00');
    assert.equal(bill.fssai_number, '12345678901234');
  } finally {
    await db.query(`update restaurants set fssai_number = null where id = $1`, [RESTAURANT_ID]);
  }
});
