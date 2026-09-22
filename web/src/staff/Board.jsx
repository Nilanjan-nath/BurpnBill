import { OrderCard } from './OrderCard.jsx';
import { useNewOrderAlerts } from './useNewOrderAlerts.js';

// Three columns, per the plan: New | Preparing | Ready. Served and cancelled
// orders leave the board entirely (slice 5 adds a Recent tab for them).
const COLUMNS = [
  { status: 'placed', title: 'New' },
  { status: 'preparing', title: 'Preparing' },
  { status: 'ready', title: 'Ready' },
];

const LIVE_LABEL = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' };

export function Board({ identity, board, onSignOut }) {
  const alerts = useNewOrderAlerts(board.newOrderCount, board.acknowledgeNewOrders);

  return (
    <div className="staff-app">
      <header className="staff-header">
        <div className="staff-header-left">
          <h1>Order board</h1>
          <span className={`staff-live staff-live-${board.liveStatus}`}>
            <span className="staff-live-dot" aria-hidden="true" />
            {LIVE_LABEL[board.liveStatus]}
          </span>
        </div>
        <div className="staff-header-right">
          {!alerts.soundEnabled && (
            <button type="button" className="staff-link" onClick={alerts.enableSound}>
              🔔 Turn on sound
            </button>
          )}
          <span className="staff-who">{identity.displayName ?? identity.role}</span>
          <button type="button" className="staff-link" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {board.conflict && (
        <div className="staff-banner" role="alert">
          <span>{board.conflict}</span>
          <button type="button" className="staff-dismiss" onClick={board.dismissConflict} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {board.error && (
        <div className="staff-banner staff-banner-error" role="alert">
          <span>{board.error}</span>
          <button type="button" onClick={board.refresh}>
            Retry
          </button>
        </div>
      )}

      {board.orders === null && !board.error ? (
        <p className="staff-loading">Loading the board…</p>
      ) : (
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
                    />
                  ))}
                  {inColumn.length === 0 && <p className="staff-empty">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
