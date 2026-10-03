import { adminApi } from './adminApi.js';
import { useLoad } from './useLoad.js';
import { Money, Tile, Problem, when } from './ui.jsx';

// The headline: how many cafés, in which state, who needs a call, and what has
// been received this month. Every list row opens that café.
export function Overview({ token, onOpenCafe }) {
  const { data, error } = useLoad(() => adminApi.overview(token), token);
  if (error) return <Problem>{error}</Problem>;
  if (!data) return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading…</p>;
  const s = data.states;

  return (
    <div className="space-y-6">
      <section aria-label="Cafés by plan" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Cafés" value={data.cafes} />
        <Tile label="On trial" value={s.trialing} />
        <Tile label="Paying" value={s.active} tone="text-ready-ink" />
        <Tile label="In grace" value={s.grace} tone={s.grace ? 'text-prep-ink' : 'text-ink-900'} />
        <Tile label="Locked" value={s.locked} tone={s.locked ? 'text-danger-700' : 'text-ink-900'} />
        <Tile
          label="Received this month"
          value={<Money value={data.received_this_month} />}
          hint={`${data.payments_this_month} ${data.payments_this_month === 1 ? 'payment' : 'payments'}`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <CafeList title="Trials ending within 7 days" rows={data.trials_ending_soon} empty="None right now." onOpen={onOpenCafe} />
        <CafeList title="Paid plans ending within 14 days" rows={data.plans_expiring_soon} empty="None right now." onOpen={onOpenCafe} />
        <CafeList
          title="On trial, no orders yet"
          rows={data.trials_with_no_orders}
          empty="Every trial café has taken an order this month."
          onOpen={onOpenCafe}
          hint="Worth a call: they signed up and have not used it."
        />
      </div>

      <section>
        <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">Sign-ups, by week</h2>
        {data.signups_by_week.length === 0 ? (
          <p className="text-sm font-semibold text-ink-700">No sign-ups in the last eight weeks.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.signups_by_week.map((w) => (
              <li key={w.week} className="rounded-input border border-ink-200 bg-paper px-3 py-1.5 text-sm font-bold text-ink-900">
                {when(w.week)}: {w.cafes}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CafeList({ title, rows, empty, onOpen, hint }) {
  return (
    <section className="rounded-card border border-ink-200 bg-paper p-4" aria-label={title}>
      <h2 className="text-sm font-extrabold text-ink-900">{title}</h2>
      {hint && <p className="text-xs font-semibold text-ink-600">{hint}</p>}
      {rows.length === 0 ? (
        <p className="mt-2 text-sm font-semibold text-ink-700">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-ink-200">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left hover:bg-ink-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-ink-900">{c.name}</span>
                  <span className="block truncate text-xs font-semibold text-ink-600">{c.owner_email ?? 'no email on file'}</span>
                </span>
                <span className="flex-none text-xs font-bold text-ink-700">{c.days_left}d</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
