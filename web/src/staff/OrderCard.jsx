import { useState } from 'react';
import { nextStatus, nextStatusLabel, canCancel } from './transitions.js';
import { ageMinutes, ageLabel, stuckLevel } from './age.js';
import { useNowTick } from './useNowTick.js';

export function OrderCard({ order, busy, skewMs, onMove }) {
  const next = nextStatus(order.status);
  const cancellable = canCancel(order.status);
  const [confirming, setConfirming] = useState(false);

  useNowTick(); // re-renders this card periodically so its age keeps advancing
  const minutes = ageMinutes(order.status_changed_at, skewMs);
  const stuck = stuckLevel(minutes);

  // v1 has no undo (see ARCHITECTURE §2) — a confirmation is the only safety
  // net before an order is cancelled. NOT window.confirm(): its own dialog
  // also has a button labelled "Cancel" (meaning "back out of this dialog"),
  // which reads as "did nothing" right next to a button that MEANS cancel
  // the order — an easy, and genuinely confusing, mis-click.
  const confirmCancel = () => {
    setConfirming(false);
    onMove(order, 'cancelled');
  };

  return (
    <article className={`staff-card${stuck ? ` staff-card-${stuck}` : ''}`}>
      <div className="staff-card-head">
        <strong>#{order.order_number}</strong>
        <span className="staff-table">Table {order.table.label}</span>
        <span className={`staff-age${stuck ? ` staff-age-${stuck}` : ''}`}>{ageLabel(minutes)}</span>
      </div>

      <ul className="staff-items">
        {order.items.map((item, i) => (
          <li key={i}>
            {item.quantity} × {item.name}
            {item.special_instructions && <em> — “{item.special_instructions}”</em>}
          </li>
        ))}
      </ul>

      {confirming ? (
        <div className="staff-confirm">
          <span>Cancel this order?</span>
          <div className="staff-confirm-actions">
            <button type="button" className="staff-keep" disabled={busy} onClick={() => setConfirming(false)}>
              Keep order
            </button>
            <button type="button" className="staff-cancel-confirm" disabled={busy} onClick={confirmCancel}>
              Yes, cancel it
            </button>
          </div>
        </div>
      ) : (
        <div className="staff-card-actions">
          {cancellable && (
            <button type="button" className="staff-cancel" disabled={busy} onClick={() => setConfirming(true)}>
              Cancel
            </button>
          )}
          {next && (
            <button type="button" className="staff-forward" disabled={busy} onClick={() => onMove(order, next)}>
              {busy ? '…' : nextStatusLabel(order.status)}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
