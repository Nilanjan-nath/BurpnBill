import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// Same two traps as every other dialog here: m-auto, because Tailwind's
// preflight kills the margin a modal <dialog> centres itself with, and an
// explicit bg/text so it can't fall back to the UA's dark canvas colour.
const PANEL = 'm-auto w-[min(26rem,92vw)] rounded-2xl bg-white p-0 text-gray-900 shadow-sm backdrop:bg-gray-900/50';

const FIELD =
  'w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 ' +
  'placeholder:font-normal placeholder:text-gray-500 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600';
const LABEL = 'mb-1.5 block text-sm font-bold text-gray-900';

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
            <h2 className="text-xl font-bold text-gray-900">{category ? 'Edit category' : 'Add category'}</h2>
            <p className="text-sm font-semibold text-gray-600">A section of the menu, in the order you want it read.</p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current.close()}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100"
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
          <p className="mt-1.5 text-xs font-semibold text-gray-600">Lower numbers come first on the customer's menu.</p>
        </div>

        {error && (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : category ? 'Save changes' : 'Create category'}
        </button>
      </form>
    </dialog>
  );
}
