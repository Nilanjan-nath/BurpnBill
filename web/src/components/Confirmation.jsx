import { formatMoney } from '../format.js';

export function Confirmation({ order, currency, onViewBill, onNewOrder }) {
  return (
    <main className="confirmation">
      <div className="check" aria-hidden="true">✓</div>
      <h1>Order placed!</h1>
      <p className="order-number">Order <strong>#{order.order_number}</strong> · Table {order.table_label}</p>
      <p>The kitchen has your order. Please pay at the counter.</p>

      <ul className="receipt" aria-label="Your order">
        {order.items.map((item, i) => (
          <li key={i}>
            <span>{item.quantity} × {item.name}{item.special_instructions && <em> — “{item.special_instructions}”</em>}</span>
            <span>{formatMoney(item.line_total, currency)}</span>
          </li>
        ))}
        <li className="total">
          <span>Total</span>
          <strong>{formatMoney(order.total_amount, currency)}</strong>
        </li>
      </ul>

      <div className="confirm-actions">
        <button type="button" className="primary" onClick={onViewBill}>View bill</button>
        <button type="button" className="secondary" onClick={onNewOrder}>Order something else</button>
      </div>
    </main>
  );
}
