import { notFound } from '../errors.js';

// A settled bill, with its lines: what the receipt prints. Everything here was
// copied onto the bill at checkout (see supabase/migrations/20261001120000_bills.sql),
// so this never joins to the menu, the orders or the café's current details —
// a reprint shows what the customer was handed, whatever has changed since.
//
// `db` may be the pool or an open transaction client; both have .query.
const BILL_COLUMNS = `id, bill_number, table_label, restaurant_name, restaurant_address, restaurant_phone,
  currency_code, payment_method, subtotal, tax_amount, total_amount, amount_tendered, change_given, settled_at,
  gstin, fssai_number, tax_rate, taxable_value, cgst_amount, sgst_amount`;

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
