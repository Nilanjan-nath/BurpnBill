import { useEffect, useRef } from 'react';
import { formatMoney, formatTime } from '../format.js';
import { useOrderDetail } from './useOrderDetail.js';

// Native <dialog> again (see ../components/ItemSheet.jsx) for the same
// reasons: focus trapping, Esc to close, a backdrop, all for free. Styled as
// a right-side drawer rather than a centred sheet — see staff.css.
export function OrderDetailDrawer({ token, orderId, onClose }) {
  const dialog = useRef(null);
  const { order, error } = useOrderDetail(token, orderId);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="staff-drawer"
      aria-label={order ? `Order #${order.order_number}` : 'Order detail'}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <div className="staff-drawer-body">
        <button type="button" className="icon-btn staff-drawer-close" onClick={() => dialog.current.close()} aria-label="Close">
          ×
        </button>

        {error && <p className="staff-error">{error}</p>}
        {!order && !error && <p className="staff-loading">Loading…</p>}

        {order && (
          <>
            <h2>
              Order #{order.order_number} <span className={`staff-status-pill staff-status-${order.status}`}>{order.status}</span>
            </h2>
            <p className="staff-table">Table {order.table.label}</p>

            <ul className="staff-drawer-items">
              {order.items.map((item, i) => (
                <li key={i}>
                  <span>
                    {item.quantity} × {item.name}
                    {item.special_instructions && <em> — “{item.special_instructions}”</em>}
                  </span>
                  <span>{formatMoney(item.line_total)}</span>
                </li>
              ))}
            </ul>

            <dl className="staff-drawer-totals">
              {Number(order.tax_amount) > 0 && (
                <>
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{formatMoney(order.subtotal)}</dd>
                  </div>
                  <div>
                    <dt>Tax</dt>
                    <dd>{formatMoney(order.tax_amount)}</dd>
                  </div>
                </>
              )}
              <div className="staff-drawer-total-row">
                <dt>Total</dt>
                <dd>{formatMoney(order.total_amount)}</dd>
              </div>
            </dl>

            <h3>Timeline</h3>
            <ol className="staff-timeline" aria-label="Status timeline">
              {order.timeline.map((event, i) => (
                <li key={i}>
                  <span className="staff-timeline-status">{event.to_status}</span>
                  <span className="staff-timeline-time">{formatTime(event.created_at)}</span>
                  <span className="staff-timeline-who">{event.changed_by ?? '—'}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </dialog>
  );
}
