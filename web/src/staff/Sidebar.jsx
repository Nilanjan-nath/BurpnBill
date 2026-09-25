import {
  ClipboardList,
  History,
  UtensilsCrossed,
  Table2,
  LayoutDashboard,
  ShoppingCart,
  Users,
} from 'lucide-react';

const ICONS = {
  board: ClipboardList,
  recent: History,
  menu: UtensilsCrossed,
  tables: Table2,
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  staff: Users,
};

// Tailwind, replacing the old plain-CSS sidebar (staff.css's .staff-sidebar)
// — see TASKS.md step 7 slice 3's redesign note for why. Same tab state/ids
// as before (Board.jsx owns `tab`/`setTab`), just a different chrome, so
// every existing test — which queries by role/name, not by class — kept
// passing untouched.
export function Sidebar({ tabs, tab, onSelect, identity }) {
  return (
    <nav aria-label="View" className="flex w-60 flex-none flex-col border-r border-gray-200 bg-white print:hidden">
      <div className="px-5 py-5 text-lg font-semibold tracking-tight text-gray-900">Petuk</div>

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
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? 'bg-teal-50 text-teal-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className="h-[18px] w-[18px] flex-none" strokeWidth={2} aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 border-t border-gray-200 px-5 py-4">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-teal-100 text-sm font-semibold text-teal-700">
          {(identity.displayName ?? identity.role).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{identity.displayName ?? identity.role}</div>
          <div className="truncate text-xs capitalize text-gray-500">{identity.role}</div>
        </div>
      </div>
    </nav>
  );
}
