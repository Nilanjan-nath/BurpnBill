import { X } from 'lucide-react';

const banner = 'mx-4 mt-3 flex items-start justify-between gap-2 rounded-2xl px-4 py-3 text-sm font-semibold';
const dismiss = 'grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-black/10 active:scale-90';

// `notice` is information (your session was reset); `problem` is something the
// last action couldn't do. Both are dismissible and announced to screen readers.
export function Banners({ notice, problem, onDismissNotice, onDismissProblem }) {
  return (
    <>
      {notice && (
        <div className={`${banner} bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100`} role="status">
          <span>{notice}</span>
          <button type="button" className={dismiss} onClick={onDismissNotice} aria-label="Dismiss message">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {problem && (
        <div className={`${banner} bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100`} role="alert">
          <span>{problem}</span>
          <button type="button" className={dismiss} onClick={onDismissProblem} aria-label="Dismiss message">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
