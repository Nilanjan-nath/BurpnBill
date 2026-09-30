import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatMoney } from '../format.js';

// Charts are hand-drawn with divs rather than pulling in a charting library:
// two bar charts is not worth a dependency in a bundle a kitchen tablet loads
// over café wifi, and this way they inherit the design system for free.

// Change against the same time yesterday. Silent when there's nothing to
// compare to — "+100%" against a zero baseline is noise, not information.
export function Delta({ today, yesterday, unit = 'money' }) {
  const t = Number(today);
  const y = Number(yesterday);
  if (y === 0) {
    if (t === 0) return null;
    return <span className="text-xs font-bold text-ink-600">First {unit === 'money' ? 'takings' : 'orders'} today</span>;
  }
  const pct = Math.round(((t - y) / y) * 100);
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  const tone = pct > 0 ? 'text-ready-ink' : pct < 0 ? 'text-danger-700' : 'text-ink-600';
  return (
    <span className={`flex items-center gap-1 text-xs font-bold ${tone}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {pct > 0 ? '+' : ''}
      {pct}% vs yesterday
    </span>
  );
}

// One bar per bucket. Each bar is focusable and carries its own label, so the
// chart is readable by keyboard and screen reader rather than being a picture
// of numbers only a sighted mouse user can get at.
export function BarChart({ bars, highlightKey, emptyLabel }) {
  const max = Math.max(...bars.map((b) => Number(b.value)), 0);
  const hasAny = max > 0;

  return (
    <div className="rounded-card border border-ink-200 bg-paper p-4">
      {!hasAny ? (
        <p className="py-10 text-center text-sm font-semibold text-ink-700">{emptyLabel}</p>
      ) : (
        <div className="flex h-44 items-end gap-1 overflow-x-auto">
          {bars.map((bar) => {
            const value = Number(bar.value);
            const pct = max === 0 ? 0 : (value / max) * 100;
            const current = bar.key === highlightKey;
            return (
              // h-full on the column is load-bearing: the row is `items-end`,
              // so children size to content unless told otherwise, and a
              // percentage bar height inside a zero-height box draws nothing.
              <div key={bar.key} className="flex h-full min-w-7 flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end">
                  <div
                    tabIndex={0}
                    role="img"
                    aria-label={`${bar.label}: ${formatMoney(bar.value)} from ${bar.orders} ${
                      bar.orders === 1 ? 'order' : 'orders'
                    }`}
                    title={`${bar.label} · ${formatMoney(bar.value)} · ${bar.orders} ${
                      bar.orders === 1 ? 'order' : 'orders'
                    }`}
                    // A zero bucket still draws a sliver, so the axis reads as
                    // "quiet hour" rather than "no data here".
                    style={{ height: `${Math.max(pct, value > 0 ? 4 : 2)}%` }}
                    className={`w-full rounded-t-md transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 ${
                      current ? 'bg-brand' : value > 0 ? 'bg-brand-200 hover:bg-brand-300' : 'bg-ink-100'
                    }`}
                  />
                </div>
                <span className={`font-mono text-[10px] font-bold tabular-nums ${current ? 'text-brand-700' : 'text-ink-500'}`}>
                  {bar.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// A proportional split — payment methods, or QR vs counter. Percentages of
// money, not of order count: two ₹30 chais and one ₹500 biryani are not
// "mostly chai" in any sense the owner cares about.
export function SplitBar({ segments, emptyLabel }) {
  const total = segments.reduce((sum, s) => sum + Number(s.value), 0);
  if (total === 0) return <p className="text-sm font-semibold text-ink-700">{emptyLabel}</p>;

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-ink-100">
        {segments.map((s) => (
          <div
            key={s.label}
            className={s.color}
            style={{ width: `${(Number(s.value) / total) * 100}%` }}
            title={`${s.label}: ${formatMoney(s.value)}`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 flex-none rounded-full ${s.color}`} aria-hidden="true" />
            <span className="flex-1 font-bold capitalize text-ink-900">{s.label}</span>
            <span className="font-mono font-semibold text-ink-600 tabular-nums">
              {Math.round((Number(s.value) / total) * 100)}%
            </span>
            <span className="w-20 text-right font-mono font-bold text-ink-900 tabular-nums">{formatMoney(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
