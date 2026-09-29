import { ArrowLeft } from 'lucide-react';

// The mustard bar the cart and the bill share with the menu's own header.
export function PageHeader({ title, subtitle, backLabel, onBack }) {
  return (
    <header className="flex items-center gap-2 border-b border-stone-200 bg-white px-3 pb-3 pt-4 text-stone-900 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-red-50 hover:text-red-700 dark:hover:bg-stone-800 dark:hover:text-red-300 active:scale-95"
      >
        <ArrowLeft className="h-6 w-6" aria-hidden="true" />
      </button>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm font-semibold text-stone-600 dark:text-stone-400">{subtitle}</p>}
      </div>
    </header>
  );
}
