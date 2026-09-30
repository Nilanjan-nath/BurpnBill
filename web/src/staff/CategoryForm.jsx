import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// Same two traps as every other dialog here: m-auto, because Tailwind's
// preflight kills the margin a modal <dialog> centres itself with, and an
// explicit bg/text so it can't fall back to the UA's dark canvas colour.
const PANEL = 'm-auto w-[min(26rem,92vw)] rounded-card bg-paper p-0 text-ink-900 shadow-pop backdrop:bg-ink-900/50';

const FIELD =
  'min-h-12 w-full rounded-input border border-ink-300 bg-paper px-3 py-2.5 text-base font-semibold text-ink-900 ' +
  'placeholder:font-normal placeholder:text-ink-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
const LABEL = 'mb-1.5 block text-sm font-bold text-ink-900';

export function CategoryForm({ category, busy, error, onSave, onClose }) {
  const dialog = useRef(null);
  const [name, setName] = useState(category?.name ?? '');
  // Blank on a new category on purpose: leaving it out puts the section at the
  // end of the menu, which is where a new one almost always belongs. Typing 0
  // would put it first, on top of whatever is there.
  const [displayOrder, setDisplayOrder] = useState(category?.display_order ?? '');

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const body = { name: name.trim() };
    if (displayOrder !== '') body.display_order = Number(displayOrder);
    if (await onSave(body)) dialog.current.close();
  };

  return (
    <dialog
      ref={dialog}
      className={PANEL}
      aria-label={category ? `Edit ${category.name}` : 'Add category'}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <form className="p-6" onSubmit={submit}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-ink-900">{category ? 'Edit category' : 'Add category'}</h2>
            <p className="text-sm font-semibold text-ink-600">A section of the menu, in the order you want it read.</p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current.close()}
            aria-label="Close"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-input text-ink-600 hover:bg-ink-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mb-4">
          <label className={LABEL} htmlFor="category-name">
            Category name
          </label>
          <input
            id="category-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            autoFocus
            placeholder="e.g. Beverages"
            className={FIELD}
          />
        </div>

        <div className="mb-5">
          <label className={LABEL} htmlFor="category-order">
            Display order
          </label>
          <input
            id="category-order"
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            min="0"
            step="1"
            placeholder={category ? undefined : 'Last on the menu'}
            className={FIELD}
          />
          <p className="mt-1.5 text-xs font-semibold text-ink-600">Lower numbers come first on the customer's menu.</p>
        </div>

        {error && (
          <p className="mb-3 rounded-card border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-bold text-danger-700" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full min-h-12 rounded-card bg-brand px-4 text-sm font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Saving…' : category ? 'Save changes' : 'Create category'}
        </button>
      </form>
    </dialog>
  );
}
