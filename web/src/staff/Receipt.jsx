import { formatMoney } from '../format.js';

// The customer's receipt. One component for the on-screen preview AND the
// printout, so what the cashier checks is what comes out of the printer.
//
// It reads only the bill (a snapshot taken at checkout, see
// server/src/services/bills.js): never the menu or the café's current details,
// so a reprint matches what the customer was handed.
//
//   size 'a4'      — a normal printer, full page width
//   size 'thermal' — an 80mm counter receipt printer
export function Receipt({ bill, size = 'a4' }) {
  const rows = mergeLines(bill.lines);
  const money = (amount) => formatMoney(amount, bill.currency_code);
  const tax = Number(bill.tax_amount);

  return (
    <div className={`bnb-receipt bnb-receipt-${size}`}>
      <header className="bnb-receipt-head">
        <h1>{bill.restaurant_name}</h1>
        {bill.restaurant_address && <p className="bnb-receipt-address">{bill.restaurant_address}</p>}
        {bill.restaurant_phone && <p>Ph: {bill.restaurant_phone}</p>}
      </header>

      <dl className="bnb-receipt-meta">
        <Meta label="Bill No." value={formatBillNumber(bill.bill_number)} />
        <Meta label="Table" value={bill.table_label} />
        <Meta label="Date" value={formatBillDate(bill.settled_at)} />
        <Meta label="Payment" value={bill.payment_method.toUpperCase()} />
      </dl>

      <table className="bnb-receipt-items">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">Rate</th>
            <th scope="col" className="num">Amt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.name}-${row.unit_price}`}>
              <td>{row.name}</td>
              <td className="num">{row.quantity}</td>
              <td className="num">{Number(row.unit_price).toFixed(2)}</td>
              <td className="num">{Number(row.line_total).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="bnb-receipt-totals">
        <Meta label="Subtotal" value={money(bill.subtotal)} />
        {tax > 0 && <Meta label="Tax" value={money(bill.tax_amount)} />}
        <Meta label="Total" value={money(bill.total_amount)} strong />
        {bill.amount_tendered != null && (
          <>
            <Meta label="Cash received" value={money(bill.amount_tendered)} />
            <Meta label="Change" value={money(bill.change_given)} />
          </>
        )}
      </dl>

      <footer className="bnb-receipt-foot">
        <p>Thank you for dining with us!</p>
        <p className="bnb-receipt-small">* Computer generated receipt *</p>
      </footer>
    </div>
  );
}

function Meta({ label, value, strong = false }) {
  return (
    <div className={strong ? 'strong' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// A table that ordered tea in two rounds should read "Masala Chai x3", not two
// lines. Same dish at the same price merges; the cook's notes stay off the
// customer's copy.
export function mergeLines(lines) {
  const merged = new Map();
  for (const line of lines) {
    const key = `${line.name}\u0000${line.unit_price}`;
    const have = merged.get(key);
    if (have) {
      have.quantity += line.quantity;
      have.line_total = (Math.round(Number(have.line_total) * 100) + Math.round(Number(line.line_total) * 100)) / 100;
    } else {
      merged.set(key, { name: line.name, unit_price: line.unit_price, quantity: line.quantity, line_total: line.line_total });
    }
  }
  return [...merged.values()];
}

// 0042 — padded so they sort and read like a pad of paper bills.
export const formatBillNumber = (n) => String(n).padStart(4, '0');

export function formatBillDate(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  return `${date} at ${time}`;
}
