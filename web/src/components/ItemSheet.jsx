import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Stepper } from './Stepper.jsx';
import { VegMark } from './VegMark.jsx';
import { input, muted, primary } from './ui.js';
import { formatMoney, lineTotal } from '../format.js';

const NOTE_MAX = 280;

// Bottom sheet for adding one item: quantity and a free-text note ("less sugar").
// Uses the native <dialog>, which gives focus trapping, Esc to close and a
// backdrop for free. Tailwind's preflight zeroes the margin the browser uses to
// place it, so it is pinned to the bottom explicitly, and it names its own
// background and text colour (docs/design.md: a <dialog> that doesn't falls
// back to the UA's canvas colour, which is dark under prefers-color-scheme).
export function ItemSheet({ item, currency, busy, onAdd, onClose }) {
  const dialog = useRef(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const add = async () => {
    if (await onAdd(quantity, note.trim())) onClose();
  };

  return (
    <dialog
      ref={dialog}
      aria-label={`Add ${item.name}`}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
      className="m-0 mt-auto w-full max-w-none overflow-visible border-0 bg-transparent p-0 text-stone-900 backdrop:bg-black/55 sm:mx-auto sm:max-w-xl"
    >
      <div className="grid gap-4 rounded-t-3xl bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 text-stone-900 shadow-2xl dark:bg-stone-900 dark:text-stone-100">
        <div className="flex items-start gap-2">
          <span className="mt-2"><VegMark isVeg={item.is_veg} /></span>
          <h2 className="flex-1 text-xl font-extrabold leading-snug">{item.name}</h2>
          <button
            type="button"
            onClick={() => dialog.current.close()}
            aria-label="Close"
            className="-mr-2 -mt-1 grid h-11 w-11 place-items-center rounded-full hover:bg-stone-100 active:scale-90 dark:hover:bg-stone-800"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        {item.description && <p className={muted}>{item.description}</p>}

        <label className="grid gap-1.5">
          <span className="font-semibold">Special instructions <small className={`font-normal ${muted}`}>(optional)</small></span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={2}
            placeholder="e.g. less sugar, no onions"
            className={`resize-none ${input}`}
          />
          <small className={`justify-self-end ${muted}`}>{note.length}/{NOTE_MAX}</small>
        </label>

        <div className="flex items-center gap-3">
          <Stepper value={quantity} onChange={setQuantity} name={item.name} disabled={busy} />
          <button type="button" className={`${primary} h-12 flex-1`} onClick={add} disabled={busy}>
            {busy ? 'Adding…' : `Add · ${formatMoney(lineTotal(item.price, quantity), currency)}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
