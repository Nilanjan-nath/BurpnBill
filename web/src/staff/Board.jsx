import { useState } from 'react';
import { Bell, LogOut } from 'lucide-react';
import { useNewOrderAlerts } from './useNewOrderAlerts.js';
import { ActiveColumns } from './ActiveColumns.jsx';
import { RecentOrders } from './RecentOrders.jsx';
import { OrderDetailDrawer } from './OrderDetailDrawer.jsx';
import { MenuTab } from './MenuTab.jsx';
import { SettingsTab } from './SettingsTab.jsx';
import { DashboardHome } from './DashboardHome.jsx';
import { POS } from './POS.jsx';
import { StaffTab } from './StaffTab.jsx';
import { Sidebar } from './Sidebar.jsx';

const TITLES = { board: 'Order board', recent: 'Recent orders', menu: 'Menu', settings: 'Settings', dashboard: 'Dashboard', pos: 'POS', staff: 'Staff' };
const LIVE_LABEL = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' };
// The connection indicator borrows the status pairs: green when live, amber
// while it retries, grey while it has not tried yet. It always says the word.
const LIVE_DOT = { live: 'bg-ready-ink', connecting: 'bg-ink-400', reconnecting: 'bg-placed-ink animate-pulse' };
const LIVE_PILL = {
  live: 'bg-ready text-ready-ink',
  connecting: 'bg-served text-served-ink',
  reconnecting: 'bg-placed text-placed-ink',
};

const TABS = [
  { id: 'board', label: 'Board' },
  { id: 'recent', label: 'Recent' },
  { id: 'menu', label: 'Menu' },
];
// Settings is last for everyone, and pinned there: its owner-only halves (the
// café profile, the seating plan) sit beside a User Account view that every
// role needs, so the tab itself is shared even though most of it isn't.
const SETTINGS_TAB = { id: 'settings', label: 'Settings' };
// Three roles (step 6 slice 5). Everyone works the board; POS is front of
// house, so 'staff' gets it but 'kitchen' doesn't; the rest is the owner's.
const POS_TAB = { id: 'pos', label: 'POS' };
const FRONT_OF_HOUSE_TABS = [POS_TAB, ...TABS, SETTINGS_TAB];
const KITCHEN_TABS = [...TABS, SETTINGS_TAB];
const OWNER_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  POS_TAB,
  ...TABS,
  { id: 'staff', label: 'Staff' },
  SETTINGS_TAB,
];
const tabsFor = (role) => (role === 'owner' ? OWNER_TABS : role === 'staff' ? FRONT_OF_HOUSE_TABS : KITCHEN_TABS);

export function Board({ identity, board, token, auth, onIdentityChange, onSignOut }) {
  const alerts = useNewOrderAlerts(board.newOrderCount, board.acknowledgeNewOrders);
  const isOwner = identity.role === 'owner';
  const tabs = tabsFor(identity.role);
  const [tab, setTab] = useState('board');
  const [detailOrderId, setDetailOrderId] = useState(null);

  return (
    <div className="staff-app brand-surface flex min-h-dvh bg-canvas">
      <Sidebar tabs={tabs} tab={tab} onSelect={setTab} identity={identity} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-ink-200 bg-paper px-6 py-4 print:hidden">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">{TITLES[tab]}</h1>
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-bold ${LIVE_PILL[board.liveStatus]}`}>
              <span className={`h-2 w-2 rounded-full ${LIVE_DOT[board.liveStatus]}`} aria-hidden="true" />
              {LIVE_LABEL[board.liveStatus]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!alerts.soundEnabled && (
              <button
                type="button"
                onClick={alerts.enableSound}
                className="flex min-h-11 items-center gap-1.5 rounded-card border-2 border-ink-300 px-3 text-sm font-bold text-ink-700 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.98]"
              >
                <Bell className="h-4 w-4" aria-hidden="true" /> Turn on sound
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="flex min-h-11 items-center gap-1.5 rounded-card border-2 border-ink-300 px-3 text-sm font-bold text-ink-700 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.98]"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
            </button>
          </div>
        </header>

        {board.conflict && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-card border border-butter-500 bg-butter-100 px-4 py-2.5 text-sm font-semibold text-ink-900" role="alert">
            <span>{board.conflict}</span>
            <button type="button" onClick={board.dismissConflict} aria-label="Dismiss" className="text-lg leading-none">
              ×
            </button>
          </div>
        )}
        {board.error && (
          <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-card border border-danger-200 bg-danger-50 px-4 py-2.5 text-sm font-semibold text-danger-700" role="alert">
            <span>{board.error}</span>
            <button type="button" onClick={board.refresh} className="font-semibold">
              Retry
            </button>
          </div>
        )}

        {/* Every tab is on the Tailwind design system now. The per-tab
            `.staff-legacy` wrapper that carried the old dark theme went with
            Recent, the last tab to be migrated — the only legacy screen left
            is sign-in, which renders outside this shell entirely. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'board' && <ActiveColumns board={board} onOpenDetail={setDetailOrderId} />}
          {tab === 'recent' && <RecentOrders token={token} onOpenDetail={setDetailOrderId} />}
          {tab === 'menu' && <MenuTab isOwner={isOwner} token={token} />}

          {tab === 'dashboard' && isOwner && <DashboardHome token={token} onNavigate={setTab} />}
          {tab === 'pos' && identity.role !== 'kitchen' && <POS token={token} />}
          {tab === 'staff' && isOwner && <StaffTab token={token} />}
          {tab === 'settings' && (
            <SettingsTab token={token} identity={identity} auth={auth} onIdentityChange={onIdentityChange} />
          )}
        </div>
      </div>

      {detailOrderId && (
        <OrderDetailDrawer token={token} orderId={detailOrderId} onClose={() => setDetailOrderId(null)} />
      )}
    </div>
  );
}
