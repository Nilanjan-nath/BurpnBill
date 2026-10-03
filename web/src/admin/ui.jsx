import { StatusPill } from '../brand/StatusPill.jsx';
import { formatMoney } from '../format.js';

// A café's plan as a brand status pill. Colour is never the only signal: the pill
// always carries the word, and the days left sit next to it.
const PLAN_PILL = {
  trialing: { status: 'placed', label: 'Trial' },
  active: { status: 'ready', label: 'Paying' },
  grace: { status: 'preparing', label: 'Grace' },
  locked: { status: 'cancelled', label: 'Locked' },
};

export function PlanPill({ plan }) {
  const p = PLAN_PILL[plan.state];
  const left =
    plan.state === 'locked'
      ? null
      : plan.state === 'grace'
        ? `locks in ${plan.days_left}d`
        : `${plan.days_left}d left`;
  return (
    <span className="inline-flex items-center gap-2" data-plan-state={plan.state}>
      <StatusPill status={p.status} label={p.label} compact />
      {left && <span className="text-xs font-semibold text-ink-700">{left}</span>}
    </span>
  );
}

export const Money = ({ value }) => (value == null ? <span>—</span> : <span>{formatMoney(value)}</span>);

export function Tile({ label, value, hint, tone = 'text-ink-900' }) {
  return (
    <div className="rounded-card border border-ink-200 bg-paper p-4">
      <div className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">{label}</div>
      <div className={`mt-1 font-display text-3xl font-extrabold ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs font-semibold text-ink-700">{hint}</div>}
    </div>
  );
}

// "+12.3%" / "-4%" / nothing when there is nothing to compare with.
export function Change({ value }) {
  if (value == null) return <span className="text-ink-600">—</span>;
  const tone = value > 0 ? 'text-ready-ink' : value < 0 ? 'text-danger-700' : 'text-ink-700';
  return (
    <span className={`font-bold ${tone}`}>
      {value > 0 ? '+' : ''}
      {value}%
    </span>
  );
}

export const when = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const ago = (iso) => {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export function Problem({ children }) {
  return (
    <p className="rounded-card border border-danger-200 bg-danger-50 px-4 py-2.5 text-sm font-semibold text-danger-700" role="alert">
      {children}
    </p>
  );
}
