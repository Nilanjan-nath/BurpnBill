import { useState } from 'react';
import { useNewOrderAlerts } from './useNewOrderAlerts.js';
import { ActiveColumns } from './ActiveColumns.jsx';
import { RecentOrders } from './RecentOrders.jsx';
import { OrderDetailDrawer } from './OrderDetailDrawer.jsx';
import { MenuTab } from './MenuTab.jsx';

const LIVE_LABEL = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' };
const TABS = [
  { id: 'board', label: 'Board' },
  { id: 'recent', label: 'Recent' },
  { id: 'menu', label: 'Menu' },
];

export function Board({ identity, board, token, onSignOut }) {
  const alerts = useNewOrderAlerts(board.newOrderCount, board.acknowledgeNewOrders);
  const [tab, setTab] = useState('board');
  const [detailOrderId, setDetailOrderId] = useState(null);

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

      <nav className="staff-tabs" aria-label="View">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`staff-tab${tab === t.id ? ' staff-tab-active' : ''}`}
            aria-current={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

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

      {tab === 'board' && <ActiveColumns board={board} onOpenDetail={setDetailOrderId} />}
      {tab === 'recent' && <RecentOrders token={token} onOpenDetail={setDetailOrderId} />}
      {tab === 'menu' && <MenuTab isOwner={identity.role === 'owner'} token={token} />}

      {detailOrderId && (
        <OrderDetailDrawer token={token} orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
      )}
    </div>
  );
}
