import { useEffect, useRef, useState } from 'react';

// Add/edit sheet, one form for both — editing always sends every field (a
// full replace, not a partial patch), so there's no "leave this blank to
// not touch it" ambiguity for the person filling it in. The API underneath
// still supports a true partial update; this UI just doesn't need it.
export function ItemForm({ item, busy, error, onSave, onClose }) {
  const dialog = useRef(null);
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? 'Uncategorised');
  const [price, setPrice] = useState(item?.price ?? '');
  const [isVeg, setIsVeg] = useState(item?.is_veg === true ? 'veg' : item?.is_veg === false ? 'nonveg' : 'unspecified');

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const body = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      category: category.trim() || 'Uncategorised',
      price: Number(price),
      is_veg: isVeg === 'unspecified' ? null : isVeg === 'veg',
    };
    if (await onSave(body)) dialog.current.close();
  };

  return (
    <dialog
      ref={dialog}
      className="sheet staff-item-sheet"
      aria-label={item ? `Edit ${item.name}` : 'Add item'}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <form className="sheet-body" onSubmit={submit}>
        <div className="sheet-head">
          <h2>{item ? 'Edit item' : 'Add item'}</h2>
          <button type="button" className="icon-btn" onClick={() => dialog.current.close()} aria-label="Close">
            ×
          </button>
        </div>

        <label className="field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus />
        </label>

        <label className="field">
          <span>Description <small>(optional)</small></span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
        </label>

        <div className="staff-form-row">
          <label className="field">
            <span>Category</span>
            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} required />
          </label>
          <label className="field">
            <span>Price (₹)</span>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} min="0" step="0.01" required />
          </label>
        </div>

        <fieldset className="staff-veg-field">
          <legend>Veg / non-veg</legend>
          {[
            ['veg', 'Veg'],
            ['nonveg', 'Non-veg'],
            ['unspecified', 'Not specified'],
          ].map(([value, label]) => (
            <label key={value} className="staff-radio">
              <input type="radio" name="is_veg" value={value} checked={isVeg === value} onChange={() => setIsVeg(value)} />
              {label}
            </label>
          ))}
        </fieldset>

        {error && (
          <p className="staff-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : item ? 'Save changes' : 'Add item'}
        </button>
      </form>
    </dialog>
  );
}
