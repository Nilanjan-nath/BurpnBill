import { primary } from './ui.js';

// Full-screen message for the states where there is no menu to show. The
// customer app's own version of Message.jsx, which stays plain CSS because the
// route fallbacks in App.jsx render before any Tailwind has loaded.
export function StateScreen({ title, children, action }) {
  return (
    <div className="min-h-dvh bg-white text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <main className="mx-auto grid max-w-md justify-items-center gap-4 px-6 pt-[20vh] text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <p className="text-stone-700 dark:text-stone-300">{children}</p>
        {action && (
          <button type="button" className={primary} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </main>
    </div>
  );
}
