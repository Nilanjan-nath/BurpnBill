import { formatMoney, formatTime } from '../format.js';
import { useRecentOrders } from './useRecentOrders.js';

// Served/cancelled orders from the last few hours — "what did table 4
// actually order", "did we already serve #1014", "why doesn't the till
// match" (something got cancelled). Each row opens the same detail drawer
// the live board uses.
export function RecentOrders({ token, onOpenDetail }) {
  const recent = useRecentOrders(token);

  if (recent.error) {
    return (
      <div className="staff-banner staff-banner-error" role="alert">
        <span>{recent.error}</span>
        <button type="button" onClick={recent.refresh}>
          Retry
        </button>
      </div>
    );
  }
  if (recent.orders === null) return <p className="staff-loading">Loading…</p>;

  return (
    <div className="staff-recent">
      <div className="staff-recent-head">
        <p className="staff-muted">Last 4 hours</p>
        <button type="button" className="staff-link" onClick={recent.refresh}>
          Refresh
        </button>
      </div>

      {recent.orders.length === 0 ? (
        <p className="staff-empty">Nothing served or cancelled recently.</p>
      ) : (
        <ul className="staff-recent-list">
          {recent.orders.map((order) => (
            <li key={order.id}>
              <button type="button" className="staff-recent-row" onClick={() => onOpenDetail(order.id)}>
                <span className={`staff-status-pill staff-status-${order.status}`}>{order.status}</span>
                <span className="staff-recent-number">#{order.order_number}</span>
                <span className="staff-table">Table {order.table.label}</span>
                <span className="staff-recent-items">
                  {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                </span>
                <span className="staff-recent-time">{formatTime(order.finished_at)}</span>
                <span className="staff-recent-total">{formatMoney(order.total_amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
