import { useState } from 'react';
import { Bell, LogOut } from 'lucide-react';
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
const LIVE_DOT = { live: 'bg-emerald-500', connecting: 'bg-gray-400', reconnecting: 'bg-amber-500 animate-pulse' };
const LIVE_PILL = {
  live: 'bg-emerald-50 text-emerald-700',
  connecting: 'bg-gray-100 text-gray-700',
  reconnecting: 'bg-amber-50 text-amber-800',
};

const TABS = [
  { id: 'board', label: 'Board' },
  { id: 'recent', label: 'Recent' },
  { id: 'menu', label: 'Menu' },
];
// Three roles (step 6 slice 5). Everyone works the board; POS is front of
// house, so 'staff' gets it but 'kitchen' doesn't; the rest is the owner's.
const FRONT_OF_HOUSE_TABS = [...TABS, { id: 'pos', label: 'POS' }];
const OWNER_TABS = [
  ...TABS,
  { id: 'tables', label: 'Tables' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pos', label: 'POS' },
  { id: 'staff', label: 'Staff' },
];
const tabsFor = (role) => (role === 'owner' ? OWNER_TABS : role === 'staff' ? FRONT_OF_HOUSE_TABS : TABS);

export function Board({ identity, board, token, onSignOut }) {
  const alerts = useNewOrderAlerts(board.newOrderCount, board.acknowledgeNewOrders);
  const isOwner = identity.role === 'owner';
  const tabs = tabsFor(identity.role);
  const [tab, setTab] = useState('board');
  const [detailOrderId, setDetailOrderId] = useState(null);

  return (
    <div className="staff-app flex min-h-dvh bg-gray-50">
      <Sidebar tabs={tabs} tab={tab} onSelect={setTab} identity={identity} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4 print:hidden">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{TITLES[tab]}</h1>
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${LIVE_PILL[board.liveStatus]}`}>
              <span className={`h-2 w-2 rounded-full ${LIVE_DOT[board.liveStatus]}`} aria-hidden="true" />
              {LIVE_LABEL[board.liveStatus]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!alerts.soundEnabled && (
              <button
                type="button"
                onClick={alerts.enableSound}
                className="flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                <Bell className="h-4 w-4" aria-hidden="true" /> Turn on sound
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
            </button>
          </div>
        </header>

        {board.conflict && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900" role="alert">
            <span>{board.conflict}</span>
            <button type="button" onClick={board.dismissConflict} aria-label="Dismiss" className="text-lg leading-none">
              ×
            </button>
          </div>
        )}
        {board.error && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800" role="alert">
            <span>{board.error}</span>
            <button type="button" onClick={board.refresh} className="font-semibold">
              Retry
            </button>
          </div>
        )}

        {/* Board, POS and Staff are the new Tailwind design; Recent, Menu and
            Tables are still the old dark theme (see staff.css's header note)
            — only the latter get .staff-legacy, so the light panels aren't
            nested inside a dark-background ancestor. */}
        <div
          className={
            ['board', 'pos', 'staff', 'dashboard'].includes(tab)
              ? 'flex min-h-0 flex-1 flex-col'
              : 'staff-legacy flex min-h-0 flex-1 flex-col'
          }
        >
          {tab === 'board' && <ActiveColumns board={board} onOpenDetail={setDetailOrderId} />}
          {tab === 'recent' && <RecentOrders token={token} onOpenDetail={setDetailOrderId} />}
          {tab === 'menu' && <MenuTab isOwner={isOwner} token={token} />}
          {tab === 'tables' && isOwner && <TablesTab token={token} />}
          {tab === 'dashboard' && isOwner && <DashboardHome token={token} onNavigate={setTab} />}
          {tab === 'pos' && identity.role !== 'kitchen' && <POS token={token} />}
          {tab === 'staff' && isOwner && <StaffTab token={token} />}
        </div>
      </div>

      {detailOrderId && (
        <OrderDetailDrawer token={token} orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
      )}
    </div>
  );
}
