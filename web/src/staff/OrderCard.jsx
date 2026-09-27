import { useState } from 'react';
import { Clock } from 'lucide-react';
import { nextStatus, nextStatusLabel, canCancel } from './transitions.js';
import { ageMinutes, ageLabel, stuckLevel } from './age.js';
import { useNowTick } from './useNowTick.js';

// An order that has sat too long gets louder, not just differently coloured:
// the whole card is ringed, so it reads across a kitchen from arm's length.
const STUCK_CARD = {
  warn: 'border-amber-400 ring-2 ring-amber-200',
  danger: 'border-red-500 ring-2 ring-red-200',
};
const STUCK_AGE = {
  warn: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
};

// The forward button is coloured by where the order is GOING, so the button
// and the column it lands in are obviously the same thing.
const FORWARD = {
  placed: 'bg-teal-600 hover:bg-teal-700',
  preparing: 'bg-emerald-600 hover:bg-emerald-700',
  ready: 'bg-gray-900 hover:bg-gray-800',
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
      className={`rounded-2xl border bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md ${
        stuck ? STUCK_CARD[stuck] : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-bold text-gray-900">Table {order.table.label}</div>
          <button
            type="button"
            onClick={() => onOpenDetail(order.id)}
            className="rounded text-xs font-bold text-gray-600 underline decoration-transparent underline-offset-2 transition-colors hover:text-teal-700 hover:decoration-current"
          >
            #{order.order_number}
          </button>
        </div>
        <span
          className={`flex flex-none items-center gap-1 rounded-full px-2 py-1 text-xs font-bold tabular-nums ${
            stuck ? STUCK_AGE[stuck] : 'bg-gray-100 text-gray-700'
          }`}
        >
          <Clock className="h-3 w-3" aria-hidden="true" />
          {ageLabel(minutes)}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-gray-200 pt-3">
        {order.items.map((item, i) => (
          <li key={i} className="text-sm font-bold text-gray-900">
            {item.quantity} × {item.name}
            {item.special_instructions && (
              <em className="mt-0.5 block text-xs font-semibold not-italic text-amber-800">
                “{item.special_instructions}”
              </em>
            )}
          </li>
        ))}
      </ul>

      {confirming ? (
        <div className="mt-3 rounded-xl bg-red-50 p-3">
          <p className="text-sm font-bold text-red-900">Cancel this order?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-lg border border-gray-300 bg-white py-2 text-xs font-bold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              Keep order
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={confirmCancel}
              className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
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
              className="flex-none rounded-xl border border-red-300 px-3 py-2.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {next && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onMove(order, next)}
              className={`flex-1 rounded-xl py-2.5 text-sm font-bold uppercase tracking-wide text-white shadow-sm transition-all active:scale-[0.98] disabled:opacity-50 ${FORWARD[order.status]}`}
            >
              {busy ? '…' : nextStatusLabel(order.status)}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
