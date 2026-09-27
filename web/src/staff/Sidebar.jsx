import {
  ClipboardList,
  History,
  UtensilsCrossed,
  LayoutDashboard,
  ShoppingCart,
  Users,
  Settings,
} from 'lucide-react';

const ICONS = {
  board: ClipboardList,
  recent: History,
  menu: UtensilsCrossed,
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  staff: Users,
  settings: Settings,
};

// Tailwind, replacing the old plain-CSS sidebar (staff.css's .staff-sidebar)
// — see TASKS.md step 7 slice 3's redesign note for why. Same tab state/ids
// as before (Board.jsx owns `tab`/`setTab`), just a different chrome, so
// every existing test — which queries by role/name, not by class — kept
// passing untouched.
export function Sidebar({ tabs, tab, onSelect, identity }) {
  const who = identity.displayName ?? identity.role;
  return (
    <nav aria-label="View" className="flex w-64 flex-none flex-col border-r border-gray-200 bg-white print:hidden">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-teal-600 text-base font-bold text-white"
          aria-hidden="true"
        >
          P
        </span>
        <span className="text-xl font-bold tracking-tight text-teal-700">Petuk</span>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-3">
        {tabs.map((t) => {
          const Icon = ICONS[t.id];
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={active}
              onClick={() => onSelect(t.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors ${
                active ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon className="h-5 w-5 flex-none" strokeWidth={2.25} aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="m-3 flex items-center gap-3 rounded-2xl bg-gray-50 p-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
          {who.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-gray-900">{who}</div>
          <div className="truncate text-xs font-bold uppercase tracking-wide text-gray-500">{identity.role}</div>
        </div>
      </div>
    </nav>
  );
}
