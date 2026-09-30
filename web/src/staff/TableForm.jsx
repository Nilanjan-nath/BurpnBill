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

// Add or rename a table. Editing changes the label and the seat count only —
// never the QR token, which is printed on something physical and would turn
// every copy of it into a dead link. Taking a table out of service is the
// pause toggle on the card, not a field in here.
export function TableForm({ table, busy, error, onSave, onClose }) {
  const dialog = useRef(null);
  const [label, setLabel] = useState(table?.label ?? '');
  const [seats, setSeats] = useState(table?.seats ?? '');

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const body = { label: label.trim(), seats: seats === '' ? null : Number(seats) };
    if (await onSave(body)) dialog.current.close();
  };

  return (
    <dialog
      ref={dialog}
      className={PANEL}
      aria-label={table ? `Edit ${table.label}` : 'Add table'}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <form className="p-6" onSubmit={submit}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-ink-900">{table ? 'Edit table' : 'Add table'}</h2>
            <p className="text-sm font-semibold text-ink-600">
              {table ? 'The printed QR code keeps working — only the name changes.' : 'It gets its own QR code straight away.'}
            </p>
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
          <label className={LABEL} htmlFor="table-label">
            Table name
          </label>
          <input
            id="table-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            required
            autoFocus
            placeholder="e.g. T5, or Window 2"
            className={FIELD}
          />
        </div>

        <div className="mb-5">
          <label className={LABEL} htmlFor="table-seats">
            Seats <span className="font-semibold text-ink-600">(optional)</span>
          </label>
          <input
            id="table-seats"
            type="number"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            min="1"
            max="99"
            step="1"
            className={FIELD}
          />
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
          {busy ? 'Saving…' : table ? 'Save changes' : 'Add table'}
        </button>
      </form>
    </dialog>
  );
}
