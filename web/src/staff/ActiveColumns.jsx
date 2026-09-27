import { OrderCard } from './OrderCard.jsx';

// Three columns, per the plan: New | Preparing | Ready. Served and cancelled
// orders leave the board entirely — the Recent tab (RecentOrders.jsx) is
// where they show up instead.
//
// The colours are the status system from docs/design.md doing its actual job:
// amber for waiting (the state it was reserved for), teal for work in hand,
// emerald for done. Deliberately not the reference screenshot's blue/orange —
// structure, not palette.
const COLUMNS = [
  {
    status: 'placed',
    title: 'New',
    accent: 'bg-amber-500',
    head: 'text-amber-900',
    count: 'bg-amber-100 text-amber-900',
  },
  {
    status: 'preparing',
    title: 'Preparing',
    accent: 'bg-teal-600',
    head: 'text-teal-800',
    count: 'bg-teal-100 text-teal-800',
  },
  {
    status: 'ready',
    title: 'Ready',
    accent: 'bg-emerald-600',
    head: 'text-emerald-800',
    count: 'bg-emerald-100 text-emerald-800',
  },
];

export function ActiveColumns({ board, onOpenDetail }) {
  if (board.orders === null && !board.error) {
    return <p className="p-10 text-center text-sm font-semibold text-gray-700">Loading the board…</p>;
  }

  const active = board.orders?.length ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:overflow-hidden">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-gray-700">
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
              className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white"
            >
              <div className={`h-1 flex-none ${col.accent}`} aria-hidden="true" />
              <div className="flex flex-none items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
                <h2 className={`text-sm font-bold uppercase tracking-wide ${col.head}`}>{col.title}</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${col.count}`}>
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
                  <p className="py-8 text-center text-sm font-semibold text-gray-500">Nothing here</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
