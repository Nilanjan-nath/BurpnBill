import { Check } from 'lucide-react';
import { OrderStatus } from './OrderStatus.jsx';
import { card, link, muted, primary, secondary } from './ui.js';
import { useOrderStatus } from '../useOrderStatus.js';
import { formatMoney } from '../format.js';

export function Confirmation({ order, currency, fetchStatus, onViewBill, onNewOrder }) {
  // Polls only while this screen is up — see useOrderStatus for the rules.
  const { status, failed, refresh } = useOrderStatus(fetchStatus);
  const mine = status?.orders.find((o) => o.id === order.id);

  return (
    <main className="mx-auto grid max-w-md justify-items-center gap-3 px-5 pb-10 pt-[10vh] text-center">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-green-600 text-white shadow-lg shadow-green-600/30" aria-hidden="true">
        <Check className="h-10 w-10" strokeWidth={3} />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">Order placed!</h1>
      <p className="text-lg">Order <strong>#{order.order_number}</strong> · Table {order.table_label}</p>
      {/* Not "the kitchen has your order": a QR order waits for the counter to
          accept it first, so that sentence was untrue for the first stretch. */}
      <p className={muted}>Your order is in. Please pay at the counter.</p>

      {mine && (
        <div className="grid w-full gap-2 text-left">
          <OrderStatus stage={mine.stage} serviceMode={status.service_mode} />
          <div className="flex items-center justify-between gap-3 px-1 text-sm">
            <span className={muted}>{failed ? "Couldn't check just now — trying again" : 'Updates by itself'}</span>
            <button type="button" className={link} onClick={refresh}>Refresh status</button>
          </div>
        </div>
      )}

      <ul className={`my-2 w-full px-4 py-1 text-left ${card}`} aria-label="Your order">
        {order.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3 border-b border-stone-200 py-3 dark:border-stone-800">
            <span>
              {item.quantity} × {item.name}
              {item.special_instructions && <em className={`not-italic ${muted}`}> — “{item.special_instructions}”</em>}
            </span>
            <span className="tabular-nums">{formatMoney(item.line_total, currency)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 py-3 text-lg font-extrabold">
          <span>Total</span>
          <strong className="tabular-nums">{formatMoney(order.total_amount, currency)}</strong>
        </li>
      </ul>

      <div className="grid w-full gap-3">
        <button type="button" className={primary} onClick={onViewBill}>View bill</button>
        <button type="button" className={secondary} onClick={onNewOrder}>Order something else</button>
      </div>
    </main>
  );
}
