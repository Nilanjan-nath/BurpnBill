import { OrderCard } from './OrderCard.jsx';
import { STATUS } from '../brand/status.js';

// Three columns, per the plan: New | Preparing | Ready. Served and cancelled
// orders leave the board entirely — the Recent tab (RecentOrders.jsx) is
// where they show up instead.
//
// The colours are the brand system's order-status pairs (brand/status.js):
// amber for waiting, blue for work in hand, green for done. Each column
// carries its colour twice — the bar across the top and the count — and the
// title always says it in words, so colour is never the only signal.
const COLUMNS = [
  { status: 'placed', title: 'New' },
  { status: 'preparing', title: 'Preparing' },
  { status: 'ready', title: 'Ready' },
];

export function ActiveColumns({ board, onOpenDetail }) {
  if (board.orders === null && !board.error) {
    return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading the board…</p>;
  }

  const active = board.orders?.length ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:overflow-hidden">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-ink-700">
          {active} {active === 1 ? 'order' : 'orders'} on the board
        </p>
      </div>

      {/* One column per status on a kitchen tablet; stacked on a phone, where
          each column scrolls with the page rather than inside itself. */}
      <div className="grid gap-3 lg:h-[calc(100dvh-13rem)] lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const inColumn = (board.orders ?? []).filter((o) => o.status === col.status);
          return (
            <section
              key={col.status}
              aria-label={col.title}
              className="flex min-h-0 flex-col overflow-hidden rounded-card border border-ink-200 bg-paper"
            >
              <div className={`h-1 flex-none ${STATUS[col.status].bar}`} aria-hidden="true" />
              <div className="flex flex-none items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
                <h2 className="font-mono text-xs font-extrabold uppercase tracking-[0.08em] text-ink-700">{col.title}</h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums ${STATUS[col.status].pill}`}
                >
                  {inColumn.length}
                </span>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {inColumn.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    busy={board.busyId === order.id}
                    skewMs={board.skewMs}
                    onMove={board.move}
                    onOpenDetail={onOpenDetail}
                  />
                ))}
                {inColumn.length === 0 && (
                  <p className="py-8 text-center text-sm font-semibold text-ink-500">Nothing here</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
