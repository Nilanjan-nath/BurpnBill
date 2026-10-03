import { adminApi } from './adminApi.js';
import { useLoad } from './useLoad.js';
import { PlanPill, Money, Problem, ago, when } from './ui.jsx';

// Every café, newest first: who they are, where their plan stands, and whether
// they are using it.
export function CafesTab({ token, onOpenCafe }) {
  const { data, error } = useLoad(() => adminApi.restaurants(token), token);
  if (error) return <Problem>{error}</Problem>;
  if (!data) return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading…</p>;
  if (data.restaurants.length === 0) return <p className="p-10 text-center text-sm font-semibold text-ink-700">No cafés yet.</p>;

  return (
    <ul className="space-y-2" aria-label="Cafés">
      {data.restaurants.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onOpenCafe(c.id)}
            className="grid w-full gap-x-4 gap-y-1 rounded-card border border-ink-200 bg-paper p-4 text-left hover:border-ink-300 hover:bg-ink-50 sm:grid-cols-[1.4fr_1fr_1fr_1fr]"
          >
            <span className="min-w-0">
              <span className="block truncate text-base font-extrabold text-ink-900">{c.name}</span>
              <span className="block truncate text-xs font-semibold text-ink-600">{c.owner_email ?? 'no email on file'} · joined {when(c.created_at)}</span>
            </span>
            <span className="self-center"><PlanPill plan={c.plan} /></span>
            <span className="self-center text-sm font-semibold text-ink-800">
              <span className="block">Last order {ago(c.last_order_at)}</span>
              <span className="block text-xs text-ink-600">{c.orders_30d} orders in 30 days</span>
            </span>
            <span className="self-center text-sm font-bold text-ink-900">
              <Money value={c.sales_30d} /> <span className="text-xs font-semibold text-ink-600">taken in 30 days</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
