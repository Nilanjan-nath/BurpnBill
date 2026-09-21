import { useEffect } from 'react';
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
      <header className="top with-back">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">←</button>
        <div>
          <h1>Your bill</h1>
          {bill && <p className="muted">{bill.restaurant.name} · Table {bill.table.label}</p>}
        </div>
      </header>

      <main className="bill">
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
          </div>
        )}
        {!bill && !error && <p className="muted empty">Loading your bill…</p>}
        {bill && <BillBody bill={bill} onOrderMore={onOrderMore} onRefresh={onLoad} />}
      </main>
    </>
  );
}

function BillBody({ bill, onOrderMore, onRefresh }) {
  const currency = bill.restaurant.currency_code;

  if (bill.orders.length === 0) {
    return (
      <div className="empty">
        <p>You haven't placed any orders yet.</p>
        <button type="button" className="primary" onClick={onOrderMore}>Browse the menu</button>
      </div>
    );
  }

  return (
    <>
      <p className="muted small">As of {formatDateTime(bill.generated_at)}</p>

      <ul className="bill-orders">
        {bill.orders.map((order) => (
          <li key={order.id} className={`bill-order ${order.cancelled ? 'cancelled' : ''}`}>
            <div className="bill-order-head">
              <strong>Order #{order.order_number}</strong>
              <span className="muted">{formatTime(order.placed_at)}</span>
              {order.cancelled && <span className="badge">Cancelled · not charged</span>}
            </div>
            <ul className="receipt-lines" aria-label={`Items in order ${order.order_number}`}>
              {order.items.map((item, i) => (
                <li key={i}>
                  <span>
                    {item.quantity} × {item.name}
                    {item.special_instructions && <em> — “{item.special_instructions}”</em>}
                  </span>
                  <span>{formatMoney(item.line_total, currency)}</span>
                </li>
              ))}
            </ul>
            <div className="bill-order-total">
              <span>Order total</span>
              <span>{formatMoney(order.total_amount, currency)}</span>
            </div>
          </li>
        ))}
      </ul>

      <dl className="bill-totals">
        {Number(bill.totals.tax) > 0 && (
          <>
            <div><dt>Subtotal</dt><dd>{formatMoney(bill.totals.subtotal, currency)}</dd></div>
            <div><dt>Tax</dt><dd>{formatMoney(bill.totals.tax, currency)}</dd></div>
          </>
        )}
        <div className="grand"><dt>Total to pay</dt><dd>{formatMoney(bill.totals.total, currency)}</dd></div>
      </dl>

      <p className="pay-note">Show this screen at the counter to pay. This is a summary of your orders, not a tax invoice.</p>

      <div className="bill-actions">
        <button type="button" className="secondary" onClick={onRefresh}>Refresh</button>
        <button type="button" className="primary" onClick={onOrderMore}>Order more</button>
      </div>
    </>
  );
}
