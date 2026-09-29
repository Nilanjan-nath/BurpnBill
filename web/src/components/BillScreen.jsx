import { useEffect } from 'react';
import { PageHeader } from './PageHeader.jsx';
import { card, muted, primary, secondary } from './ui.js';
import { formatDateTime, formatMoney, formatTime } from '../format.js';

// A read-only summary of everything this phone has ordered, to show the
// cashier before paying at the counter. Fetched fresh every time it opens, so
// an order the staff cancelled is already reflected.
export function BillScreen({ bill, error, onLoad, onBack, onOrderMore }) {
  useEffect(() => {
    onLoad();
  }, [onLoad]);

  return (
    <>
      <PageHeader
        title="Your bill"
        subtitle={bill ? `${bill.restaurant.name} · Table ${bill.table.label}` : undefined}
        backLabel="Back"
        onBack={onBack}
      />

      <main className="grid gap-3 px-4 pb-10 pt-5">
        {error && (
          <div className="rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-900 dark:bg-red-950 dark:text-red-100" role="alert">
            <span>{error}</span>
          </div>
        )}
        {!bill && !error && <p className={`py-16 text-center ${muted}`}>Loading your bill…</p>}
        {bill && <BillBody bill={bill} onOrderMore={onOrderMore} onRefresh={onLoad} />}
      </main>
    </>
  );
}

function BillBody({ bill, onOrderMore, onRefresh }) {
  const currency = bill.restaurant.currency_code;

  if (bill.orders.length === 0) {
    return (
      <div className="grid justify-items-center gap-4 py-16 text-center">
        <p className="font-semibold">You haven't placed any orders yet.</p>
        <button type="button" className={primary} onClick={onOrderMore}>Browse the menu</button>
      </div>
    );
  }

  return (
    <>
      <p className={`px-1 text-sm ${muted}`}>As of {formatDateTime(bill.generated_at)}</p>

      <ul className="grid gap-3">
        {bill.orders.map((order) => (
          <li key={order.id} className={`p-4 ${card} ${order.cancelled ? 'shadow-none' : ''}`}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <strong className="font-extrabold">Order #{order.order_number}</strong>
              <span className={muted}>{formatTime(order.placed_at)}</span>
              {order.cancelled && (
                <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900 dark:bg-red-950 dark:text-red-100">
                  Cancelled · not charged
                </span>
              )}
            </div>
            <ul className={`grid gap-1.5 ${order.cancelled ? 'line-through opacity-60' : ''}`} aria-label={`Items in order ${order.order_number}`}>
              {order.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3 tabular-nums">
                  <span>
                    {item.quantity} × {item.name}
                    {item.special_instructions && <em className={`not-italic ${muted}`}> — “{item.special_instructions}”</em>}
                  </span>
                  <span>{formatMoney(item.line_total, currency)}</span>
                </li>
              ))}
            </ul>
            <div className={`mt-3 flex justify-between border-t border-dashed border-stone-300 pt-2 font-bold dark:border-stone-700 ${order.cancelled ? 'line-through opacity-60' : ''}`}>
              <span>Order total</span>
              <span>{formatMoney(order.total_amount, currency)}</span>
            </div>
          </li>
        ))}
      </ul>

      <dl className="grid gap-1.5 rounded-2xl border-2 border-red-600 bg-white p-4 text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100">
        {Number(bill.totals.tax) > 0 && (
          <>
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatMoney(bill.totals.subtotal, currency)}</dd></div>
            <div className="flex justify-between"><dt>Tax</dt><dd>{formatMoney(bill.totals.tax, currency)}</dd></div>
          </>
        )}
        <div className="flex justify-between text-2xl font-extrabold"><dt>Total to pay</dt><dd>{formatMoney(bill.totals.total, currency)}</dd></div>
      </dl>

      <p className={`text-center text-sm ${muted}`}>Show this screen at the counter to pay. This is a summary of your orders, not a tax invoice.</p>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={secondary} onClick={onRefresh}>Refresh</button>
        <button type="button" className={primary} onClick={onOrderMore}>Order more</button>
      </div>
    </>
  );
}
