import { muted } from './ui.js';

// What the phone tells someone about one order. The wording for "ready" is the
// one place the café's service mode matters: at a table-service café someone
// still has to carry it out, at a self-service one the customer has to come and
// get it, and promising the wrong one is worse than saying nothing.
//
// Deliberately no time estimate — nothing records how long anything takes, and a
// wrong "8 min" is worse than none.
const STEPS = ['Placed', 'Accepted', 'Preparing', 'Ready'];
const STEP_OF = { awaiting: 0, accepted: 1, preparing: 2, ready: 3, served: 3 };

function words(stage, serviceMode) {
  switch (stage) {
    case 'awaiting':
      return 'Waiting for the counter to accept your order';
    case 'accepted':
      return 'Accepted — the kitchen will start soon';
    case 'preparing':
      return 'Being prepared';
    case 'ready':
      return serviceMode === 'counter'
        ? 'Ready — please collect it from the counter'
        : 'Ready — on its way to your table';
    case 'served':
      return 'Served — enjoy!';
    case 'cancelled':
      return "Cancelled — please ask at the counter if you're not sure why";
    default:
      return null;
  }
}

const tone = {
  cancelled: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
  ready: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100',
  served: 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100',
  preparing: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
};
const neutral = 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-100';

export function OrderStatus({ stage, serviceMode, showSteps = true }) {
  const text = words(stage, serviceMode);
  if (!text) return null;
  const reached = STEP_OF[stage];

  return (
    <div className="grid gap-2">
      {/* aria-live: the whole point is that this changes while someone is
          looking at something else, so a screen reader is told when it does. */}
      <p
        aria-live="polite"
        className={`rounded-xl px-3 py-2 text-sm font-bold ${tone[stage] ?? neutral}`}
      >
        {text}
      </p>
      {showSteps && reached !== undefined && (
        <ol className="grid grid-cols-4 gap-1.5" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className="grid gap-1" aria-current={i === reached ? 'step' : undefined}>
              <span className={`h-1.5 rounded-full ${i <= reached ? 'bg-red-600' : 'bg-stone-200 dark:bg-stone-700'}`} />
              <span className={`text-center text-[11px] font-semibold ${i <= reached ? 'text-stone-900 dark:text-stone-100' : muted}`}>
                {label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
