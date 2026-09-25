import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useNewOrderAlerts } from './useNewOrderAlerts.js';
import { ActiveColumns } from './ActiveColumns.jsx';
import { RecentOrders } from './RecentOrders.jsx';
import { OrderDetailDrawer } from './OrderDetailDrawer.jsx';
import { MenuTab } from './MenuTab.jsx';
import { TablesTab } from './TablesTab.jsx';
import { DashboardHome } from './DashboardHome.jsx';
import { POS } from './POS.jsx';
import { StaffTab } from './StaffTab.jsx';
import { Sidebar } from './Sidebar.jsx';

const TITLES = { board: 'Order board', recent: 'Recent orders', menu: 'Menu', tables: 'Tables', dashboard: 'Dashboard', pos: 'POS', staff: 'Staff' };
const LIVE_LABEL = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' };
const LIVE_DOT = { live: 'bg-emerald-500', connecting: 'bg-gray-300', reconnecting: 'bg-amber-500 animate-pulse' };
const LIVE_TEXT = { live: 'text-emerald-600', connecting: 'text-gray-500', reconnecting: 'text-amber-600' };

const TABS = [
  { id: 'board', label: 'Board' },
  { id: 'recent', label: 'Recent' },
  { id: 'menu', label: 'Menu' },
];
// Owner only — kitchen staff have no reduced view for any of these (no
// reason for the kitchen to be adding tables, running the POS, managing
// staff or looking at revenue). Dashboard/Staff are step 7's shell — each
// is a placeholder until its own slice fills it in.
const OWNER_TABS = [
  ...TABS,
  { id: 'tables', label: 'Tables' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pos', label: 'POS' },
  { id: 'staff', label: 'Staff' },
];

export function Board({ identity, board, token, onSignOut }) {
  const alerts = useNewOrderAlerts(board.newOrderCount, board.acknowledgeNewOrders);
  const isOwner = identity.role === 'owner';
  const tabs = isOwner ? OWNER_TABS : TABS;
  const [tab, setTab] = useState('board');
  const [detailOrderId, setDetailOrderId] = useState(null);

  return (
    <div className="flex min-h-dvh bg-gray-50">
      <Sidebar tabs={tabs} tab={tab} onSelect={setTab} identity={identity} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4 print:hidden">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-gray-900">{TITLES[tab]}</h1>
            <span className={`flex items-center gap-1.5 text-xs font-medium ${LIVE_TEXT[board.liveStatus]}`}>
              <span className={`h-2 w-2 rounded-full ${LIVE_DOT[board.liveStatus]}`} aria-hidden="true" />
              {LIVE_LABEL[board.liveStatus]}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {!alerts.soundEnabled && (
              <button
                type="button"
                onClick={alerts.enableSound}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
              >
                <Bell className="h-4 w-4" aria-hidden="true" /> Turn on sound
              </button>
            )}
            <button type="button" onClick={onSignOut} className="text-sm font-medium text-gray-500 underline hover:text-gray-900">
              Sign out
            </button>
          </div>
        </header>

        {board.conflict && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800" role="alert">
            <span>{board.conflict}</span>
            <button type="button" onClick={board.dismissConflict} aria-label="Dismiss" className="text-lg leading-none">
              ×
            </button>
          </div>
        )}
        {board.error && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700" role="alert">
            <span>{board.error}</span>
            <button type="button" onClick={board.refresh} className="font-semibold">
              Retry
            </button>
          </div>
        )}

        {/* POS is the new Tailwind design; everything else here is still the
            old dark theme (see staff.css's header note) — only the latter
            gets .staff-legacy, so POS's own light panels aren't nested
            inside a dark-background ancestor. */}
        <div className={tab === 'pos' ? 'flex min-h-0 flex-1 flex-col' : 'staff-legacy flex min-h-0 flex-1 flex-col'}>
          {tab === 'board' && <ActiveColumns board={board} onOpenDetail={setDetailOrderId} />}
          {tab === 'recent' && <RecentOrders token={token} onOpenDetail={setDetailOrderId} />}
          {tab === 'menu' && <MenuTab isOwner={isOwner} token={token} />}
          {tab === 'tables' && isOwner && <TablesTab token={token} />}
          {tab === 'dashboard' && isOwner && <DashboardHome />}
          {tab === 'pos' && isOwner && <POS token={token} />}
          {tab === 'staff' && isOwner && <StaffTab />}
        </div>
      </div>

      {detailOrderId && (
        <div className="staff-legacy">
          <OrderDetailDrawer token={token} orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
        </div>
      )}
    </div>
  );
}
