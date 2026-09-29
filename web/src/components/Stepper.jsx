import { Minus, Plus, X } from 'lucide-react';

// − 2 +  Used in the item sheet (min 1) and in the cart (min 0 = remove the line).
export function Stepper({ value, onChange, name, min = 1, max = 99, disabled }) {
  const removes = min === 0 && value === 1;
  const button =
    'grid h-11 w-11 place-items-center text-stone-900 hover:bg-red-50 dark:hover:bg-stone-800 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-stone-100 dark:hover:bg-stone-800';
  return (
    <div className="inline-flex items-center overflow-hidden rounded-2xl border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900">
      <button
        type="button"
        className={button}
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= min}
        aria-label={removes ? `Remove ${name}` : `Decrease quantity of ${name}`}
      >
        {removes ? <X className="h-5 w-5" aria-hidden="true" /> : <Minus className="h-5 w-5" aria-hidden="true" />}
      </button>
      <span className="min-w-8 text-center font-bold tabular-nums" aria-live="polite" aria-label={`Quantity of ${name}`}>
        {value}
      </span>
      <button
        type="button"
        className={button}
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        aria-label={`Increase quantity of ${name}`}
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
