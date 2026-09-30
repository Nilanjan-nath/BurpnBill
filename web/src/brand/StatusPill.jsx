import { STATUS } from './status.js';

// The brand's status pill: a full pill, a dot in the text colour, then the
// word. `label` overrides the default wording where a screen has its own (Recent
// says "Served"/"Cancelled"; a column count has no dot at all and doesn't use
// this). `compact` is for a table cell that cannot spare the room: sans, not
// mono, at 11px, which is what lets "Cancelled" fit Recent's 88px column.
export function StatusPill({ status, label, compact = false, className = '' }) {
  const s = STATUS[status];
  if (!s) return null;
  const size = compact ? 'gap-1 px-2 font-sans text-[11px]' : 'gap-1.5 px-3 font-mono text-xs';
  return (
    <span className={`inline-flex items-center rounded-full py-0.5 font-bold ${size} ${s.pill} ${className}`}>
      <span className="h-2 w-2 flex-none rounded-full bg-current" aria-hidden="true" />
      {label ?? s.label}
    </span>
  );
}
