// The customer app's shared class strings. Tailwind finds classes by scanning
// source for whole strings, so these can live in a constant and still be
// generated. Two accents, used on purpose (see docs/design.md, "The customer
// app"): mustard for the frame and the small actions, and red for the ONE
// thing per screen the person came to do. Text is never mustard on a light
// surface — that pairing is unreadable — so mustard is always a fill.

// Every surface names its own background and text colour: a <dialog> or a
// fixed bar that inherits falls back to the UA's colours, which flip under
// prefers-color-scheme: dark.
export const card =
  'rounded-2xl border border-stone-100 bg-white text-stone-900 shadow-[0_2px_14px_rgba(28,25,23,0.09)] dark:border-stone-800 dark:shadow-none dark:bg-stone-900 dark:text-stone-100';
export const muted = 'text-stone-600 dark:text-stone-400';

// The single most important action on a screen.
export const primary =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 text-lg font-bold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100';
// Everything that is an action but not THE action.
export const secondary =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-red-50 px-6 font-bold text-red-700 transition hover:bg-red-100 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100';
export const link =
  'font-semibold text-red-700 underline underline-offset-2 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300';
export const input =
  'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-base text-stone-900 placeholder:text-stone-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-400';
