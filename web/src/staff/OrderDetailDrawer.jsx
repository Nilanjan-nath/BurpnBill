import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { formatMoney, formatTime } from '../format.js';
import { useOrderDetail } from './useOrderDetail.js';
import { StatusPill } from '../brand/StatusPill.jsx';

// Native <dialog> again (see ../components/ItemSheet.jsx) for the same
// reasons: focus trapping, Esc to close, a backdrop, all for free. A
// right-side drawer rather than a centred sheet, so the board stays visible
// behind it — you open this to check one order, not to leave the board.
//
// bg/text are explicit, and `ml-auto` replaces the centring margin: a <dialog>
// with neither inherits the UA's dark `canvas` colour in dark mode, and
// Tailwind's preflight zeroes the margin the browser uses to place it. Both
// traps are written up in docs/design.md.
const DRAWER =
  'ml-auto mr-0 my-0 h-[100dvh] max-h-none w-[min(30rem,100vw)] max-w-none rounded-none bg-paper p-0 text-ink-900 shadow-pop backdrop:bg-ink-900/50';

export function OrderDetailDrawer({ token, orderId, onClose }) {
  const dialog = useRef(null);
  const { order, error } = useOrderDetail(token, orderId);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={DRAWER}
      aria-label={order ? `Order #${order.order_number}` : 'Order detail'}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-none items-start justify-between gap-3 border-b border-ink-200 px-5 py-4">
          <div>
            {order ? (
              <>
                <h2 className="flex items-center gap-2 text-lg font-extrabold text-ink-900">
                  Order #{order.order_number}
                  <StatusPill status={order.status} label={order.status} className="capitalize" />
                </h2>
                <p className="text-sm font-semibold text-ink-600">Table {order.table.label}</p>
              </>
            ) : (
              <h2 className="text-lg font-extrabold text-ink-900">Order detail</h2>
            )}
          </div>
          <button
            type="button"
            onClick={() => dialog.current.close()}
            aria-label="Close"
            className="flex min-h-11 min-w-11 flex-none items-center justify-center rounded-input text-ink-600 hover:bg-ink-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm font-bold text-danger-700">{error}</p>}
          {!order && !error && <p className="text-sm font-semibold text-ink-700">Loading…</p>}

          {order && (
            <>
              <ul className="divide-y divide-ink-200 rounded-card bg-ink-50 px-3">
                {order.items.map((item, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-2.5">
                    <span className="text-sm font-bold text-ink-900">
                      {item.quantity} × {item.name}
                      {item.special_instructions && (
                        <em className="mt-0.5 block text-xs font-semibold not-italic text-placed-ink">
                          “{item.special_instructions}”
                        </em>
                      )}
                    </span>
                    <span className="flex-none font-mono text-sm font-bold text-ink-900">{formatMoney(item.line_total)}</span>
                  </li>
                ))}
              </ul>

              <dl className="mt-4 space-y-1.5 border-t border-ink-200 pt-3">
                {Number(order.tax_amount) > 0 && (
                  <>
                    <div className="flex justify-between text-sm font-semibold text-ink-700">
                      <dt>Subtotal</dt>
                      <dd className="font-mono">{formatMoney(order.subtotal)}</dd>
                    </div>
                    <div className="flex justify-between text-sm font-semibold text-ink-700">
                      <dt>Tax</dt>
                      <dd className="font-mono">{formatMoney(order.tax_amount)}</dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-base font-bold text-ink-900">
                  <dt>Total</dt>
                  <dd className="font-mono">{formatMoney(order.total_amount)}</dd>
                </div>
              </dl>

              <h3 className="mt-6 font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">Timeline</h3>
              <ol className="mt-2 space-y-2" aria-label="Status timeline">
                {order.timeline.map((event, i) => (
                  <li key={i} className="flex items-baseline gap-3 rounded-input border border-ink-200 px-3 py-2">
                    <StatusPill status={event.to_status} label={event.to_status} className="flex-none capitalize" />
                    <span className="text-xs font-semibold text-ink-600">{formatTime(event.created_at)}</span>
                    <span className="ml-auto truncate text-xs font-bold text-ink-800">{event.changed_by ?? '—'}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
