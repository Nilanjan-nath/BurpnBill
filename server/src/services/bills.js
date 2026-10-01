import { notFound } from '../errors.js';

// A settled bill, with its lines: what the receipt prints. Everything here was
// copied onto the bill at checkout (see supabase/migrations/20261001120000_bills.sql),
// so this never joins to the menu, the orders or the café's current details —
// a reprint shows what the customer was handed, whatever has changed since.
//
// `db` may be the pool or an open transaction client; both have .query.
// What a receipt prints. getBill (staff) adds the ids; getPublicReceipt does not.
const RECEIPT_COLUMNS = `bill_number, table_label, restaurant_name, restaurant_address, restaurant_phone,
  currency_code, payment_method, subtotal, tax_amount, total_amount, amount_tendered, change_given, settled_at,
  gstin, fssai_number, tax_rate, taxable_value, cgst_amount, sgst_amount`;
const BILL_COLUMNS = `id, public_token, ${RECEIPT_COLUMNS}`;

export async function getBill(db, restaurantId, billId) {
  const { rows } = await db.query(
    `select ${BILL_COLUMNS} from public.bills where id = $1 and restaurant_id = $2`,
    [billId, restaurantId],
  );
  if (!rows.length) throw notFound('Bill not found');

  const { rows: lines } = await db.query(
    `select order_number, name, quantity, unit_price, line_total, special_instructions
       from public.bill_lines where bill_id = $1 order by sort_order`,
    [billId],
  );
  return { ...rows[0], lines };
}

// GET /receipts/:token — the PUBLIC read of a bill, for the page the receipt's
// QR code opens. No login, so the unguessable token is the whole access check.
//
// It returns the receipt and nothing else: no bill id, no restaurant id, no
// who-settled-it, and not the token back. A receipt carries no personal data
// of the customer (the app never collects any), and this must not start to.
// Anything that is not a well-formed token is answered without touching the
// database.
const TOKEN = /^[0-9a-f]{32}$/;

export async function getPublicReceipt(db, token) {
  if (!TOKEN.test(token)) throw notFound('Receipt not found');
  const { rows } = await db.query(
    `select id, ${RECEIPT_COLUMNS} from public.bills where public_token = $1`,
    [token],
  );
  if (!rows.length) throw notFound('Receipt not found');
  const { id, ...bill } = rows[0];

  const { rows: lines } = await db.query(
    `select order_number, name, quantity, unit_price, line_total
       from public.bill_lines where bill_id = $1 order by sort_order`,
    [id],
  );
  return { ...bill, lines };
}
