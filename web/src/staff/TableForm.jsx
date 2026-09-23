import { useEffect, useRef, useState } from 'react';

// Add-table sheet. Unlike ItemForm there's no edit mode yet — renaming or
// deactivating an existing table is on the "after v1" list (ARCHITECTURE.md).
export function TableForm({ busy, error, onSave, onClose }) {
  const dialog = useRef(null);
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState('');

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
      className="sheet staff-item-sheet"
      aria-label="Add table"
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <form className="sheet-body" onSubmit={submit}>
        <div className="sheet-head">
          <h2>Add table</h2>
          <button type="button" className="icon-btn" onClick={() => dialog.current.close()} aria-label="Close">
            ×
          </button>
        </div>

        <label className="field">
          <span>Label</span>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} required autoFocus />
        </label>

        <label className="field">
          <span>Seats <small>(optional)</small></span>
          <input type="number" value={seats} onChange={(e) => setSeats(e.target.value)} min="1" max="100" step="1" />
        </label>

        {error && (
          <p className="staff-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add table'}
        </button>
      </form>
    </dialog>
  );
}
