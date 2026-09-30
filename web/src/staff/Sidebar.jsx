import {
  ClipboardList,
  History,
  UtensilsCrossed,
  LayoutDashboard,
  ShoppingCart,
  Users,
  Settings,
} from 'lucide-react';
import { Logo } from '../brand/Logo.jsx';

const ICONS = {
  board: ClipboardList,
  recent: History,
  menu: UtensilsCrossed,
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  staff: Users,
  settings: Settings,
};

// The brand system's dark ink rail (docs/design.md, "The dashboard shell"):
// warm ink ground, the wordmark in its butter colourway, crimson for the one
// active view. Same tab state/ids as ever (Board.jsx owns `tab`/`setTab`), so
// tests — which query by role/name, not by class — are unaffected.
export function Sidebar({ tabs, tab, onSelect, identity }) {
  // The café, not the person. What this footer answers is "which café am I
  // looking at" — the thing every number on every tab is scoped to — and on a
  // shared till that is the question with a wrong answer worth catching. Who
  // is signed in lives in Settings → User account, which is also the only
  // place it can be changed.
  const cafe = identity.restaurantName ?? '';
  return (
    <nav aria-label="View" className="flex w-64 flex-none flex-col bg-ink-900 print:hidden">
      <div className="px-5 py-6">
        <Logo variant="ink" width={128} />
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
              className={`flex min-h-12 w-full items-center gap-3 rounded-card px-3 text-[15px] font-bold transition-colors duration-150 ease-tap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-butter-300 ${
                active ? 'bg-brand text-white' : 'text-ink-300 hover:bg-ink-800 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5 flex-none" strokeWidth={2.25} aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="m-3 flex items-center gap-3 rounded-card bg-ink-800 p-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-butter-300 font-display text-base font-extrabold text-ink-900">
          {cafe.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 text-sm font-bold text-white">
          {/* Two lines' worth of room for one line of name: a café called
              "The Third Wave Coffee Roasters" wraps rather than being cut
              down to something nobody would recognise. */}
          <span className="line-clamp-2">{cafe}</span>
        </div>
      </div>
    </nav>
  );
}
