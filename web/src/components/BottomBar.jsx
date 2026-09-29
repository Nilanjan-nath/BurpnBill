import { ShoppingBag } from 'lucide-react';

// The one full-width action pinned to the bottom of the screen — "View order"
// on the menu, "Place order" in the cart. Red, because it is the most
// important thing on either screen. The wrapper ignores pointer events so the
// gutters either side of the button never swallow a tap on the list beneath.
export function BottomBar({ label, total, onClick, disabled }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="pointer-events-auto mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-3 rounded-2xl bg-red-600 px-5 text-white shadow-lg shadow-black/25 transition hover:bg-red-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
      >
        <span className="flex items-center gap-3 text-lg font-bold">
          <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </span>
        <strong className="text-lg tabular-nums">{total}</strong>
      </button>
    </div>
  );
}
