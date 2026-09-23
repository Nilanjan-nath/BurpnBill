import { OrderCard } from './OrderCard.jsx';

// Three columns, per the plan: New | Preparing | Ready. Served and cancelled
// orders leave the board entirely — the Recent tab (RecentOrders.jsx) is
// where they show up instead.
const COLUMNS = [
  { status: 'placed', title: 'New' },
  { status: 'preparing', title: 'Preparing' },
  { status: 'ready', title: 'Ready' },
];

export function ActiveColumns({ board, onOpenDetail }) {
  if (board.orders === null && !board.error) return <p className="staff-loading">Loading the board…</p>;

  return (
    <div className="staff-columns">
      {COLUMNS.map((col) => {
        const inColumn = (board.orders ?? []).filter((o) => o.status === col.status);
        return (
          <section key={col.status} className="staff-column" aria-label={col.title}>
            <h2>
              {col.title} <span className="staff-count">{inColumn.length}</span>
            </h2>
            <div className="staff-cards">
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
              {inColumn.length === 0 && <p className="staff-empty">Nothing here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
