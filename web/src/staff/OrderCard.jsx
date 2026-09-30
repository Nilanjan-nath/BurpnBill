import { useState } from 'react';
import { Clock } from 'lucide-react';
import { nextStatus, nextStatusLabel, canCancel } from './transitions.js';
import { ageMinutes, ageLabel, stuckLevel } from './age.js';
import { useNowTick } from './useNowTick.js';
import { STATUS } from '../brand/status.js';

// An order that has sat too long gets louder, not just differently coloured:
// the whole card is ringed, so it reads across a kitchen from arm's length.
const STUCK_CARD = {
  warn: 'border-placed-ink ring-2 ring-placed',
  danger: 'border-danger-500 ring-2 ring-danger-100',
};
const STUCK_AGE = {
  warn: 'bg-placed text-placed-ink',
  danger: 'bg-danger-100 text-danger-700',
};

export function OrderCard({ order, busy, skewMs, onMove, onOpenDetail }) {
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
    <article
      // data-stuck rather than a styling class: the threshold is behaviour
      // worth asserting on, and it shouldn't break the next time the look changes.
      data-stuck={stuck ?? undefined}
      // The ticket's left edge is its status colour (brand system, "board"), so
      // a card is recognisable even when it has been dragged out of context.
      className={`rounded-card border border-l-4 bg-paper p-3.5 ${STATUS[order.status]?.edge ?? ''} ${
        stuck ? STUCK_CARD[stuck] : 'border-ink-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-extrabold text-ink-900">Table {order.table.label}</div>
          <button
            type="button"
            onClick={() => onOpenDetail(order.id)}
            className="rounded font-mono text-xs font-bold text-ink-600 underline decoration-transparent underline-offset-2 transition-colors hover:text-brand hover:decoration-current"
          >
            #{order.order_number}
          </button>
        </div>
        <span
          className={`flex flex-none items-center gap-1 rounded-full px-2 py-1 font-mono text-xs font-bold tabular-nums ${
            stuck ? STUCK_AGE[stuck] : 'bg-ink-100 text-ink-700'
          }`}
        >
          <Clock className="h-3 w-3" aria-hidden="true" />
          {ageLabel(minutes)}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-ink-200 pt-3">
        {order.items.map((item, i) => (
          <li key={i} className="text-sm font-bold text-ink-900">
            {item.quantity} × {item.name}
            {item.special_instructions && (
              <em className="mt-0.5 block text-xs font-semibold not-italic text-placed-ink">
                “{item.special_instructions}”
              </em>
            )}
          </li>
        ))}
      </ul>

      {confirming ? (
        <div className="mt-3 rounded-card bg-danger-50 p-3">
          <p className="text-sm font-bold text-danger-700">Cancel this order?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="min-h-12 flex-1 rounded-card border-2 border-ink-300 bg-paper text-sm font-bold text-ink-800 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.98] disabled:opacity-50"
            >
              Keep order
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={confirmCancel}
              className="min-h-12 flex-1 rounded-card bg-danger-500 text-sm font-bold text-white transition duration-150 ease-tap hover:bg-danger-600 active:scale-[0.98] disabled:opacity-50"
            >
              Yes, cancel it
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          {cancellable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
              className="min-h-12 flex-none rounded-card border-2 border-danger-500 px-4 text-sm font-bold text-danger-700 transition duration-150 ease-tap hover:bg-danger-50 active:scale-[0.98] disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {next && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onMove(order, next)}
              className="min-h-12 flex-1 rounded-card bg-brand text-sm font-bold uppercase tracking-wide text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? '…' : nextStatusLabel(order.status)}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
