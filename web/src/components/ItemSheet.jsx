import { useEffect, useRef, useState } from 'react';
import { Stepper } from './Stepper.jsx';
import { VegMark } from './VegMark.jsx';
import { formatMoney, lineTotal } from '../format.js';

const NOTE_MAX = 280;

// Bottom sheet for adding one item: quantity and a free-text note ("less sugar").
// Uses the native <dialog>, which gives focus trapping, Esc to close and a
// backdrop for free.
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
      className="sheet"
      aria-label={`Add ${item.name}`}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <div className="sheet-body">
        <div className="sheet-head">
          <VegMark isVeg={item.is_veg} />
          <h2>{item.name}</h2>
          <button type="button" className="icon-btn" onClick={() => dialog.current.close()} aria-label="Close">×</button>
        </div>
        {item.description && <p className="muted">{item.description}</p>}

        <label className="field">
          <span>Special instructions <small>(optional)</small></span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            rows={2}
            placeholder="e.g. less sugar, no onions"
          />
          <small className="muted counter">{note.length}/{NOTE_MAX}</small>
        </label>

        <div className="sheet-actions">
          <Stepper value={quantity} onChange={setQuantity} name={item.name} disabled={busy} />
          <button type="button" className="primary grow" onClick={add} disabled={busy}>
            {busy ? 'Adding…' : `Add · ${formatMoney(lineTotal(item.price, quantity), currency)}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
