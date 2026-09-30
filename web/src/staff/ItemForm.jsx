import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';

// m-auto is load-bearing: Tailwind's preflight sets `margin: 0` on every
// element, which overrides the `margin: auto` a native modal <dialog> relies on
// to centre itself. bg/text are explicit for the reason in docs/design.md (a
// <dialog> with no background falls back to the UA's dark `canvas` colour).
const PANEL =
  'm-auto w-[min(32rem,92vw)] rounded-card bg-paper p-0 text-ink-900 shadow-pop backdrop:bg-ink-900/50';

const FIELD =
  'min-h-12 w-full rounded-input border border-ink-300 bg-paper px-3 py-2.5 text-base font-semibold text-ink-900 ' +
  'placeholder:font-normal placeholder:text-ink-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
const LABEL = 'mb-1.5 block text-sm font-bold text-ink-900';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

// Add/edit sheet, one form for both — editing always sends every field (a
// full replace, not a partial patch), so there's no "leave this blank to
// not touch it" ambiguity for the person filling it in. The API underneath
// still supports a true partial update; this UI just doesn't need it.
export function ItemForm({ item, categories, busy, error, onSave, onUploadImage, onRemoveImage, onClose }) {
  const dialog = useRef(null);
  const fileInput = useRef(null);
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '');
  const [price, setPrice] = useState(item?.price ?? '');
  const [isVeg, setIsVeg] = useState(item?.is_veg === true ? 'veg' : item?.is_veg === false ? 'nonveg' : 'unspecified');

  // The photo is held here until there's an item to attach it to. For a new
  // item that is after the save; for an existing one it uploads immediately,
  // because the item is already there to carry it.
  const [pendingFile, setPendingFile] = useState(null);
  const [preview, setPreview] = useState(item?.image_url ?? null);
  const [photoError, setPhotoError] = useState(null);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  // A blob: URL is a live handle into memory, not a string — it has to be
  // released or the file stays held for as long as the tab is open.
  useEffect(() => {
    if (!pendingFile) return undefined;
    const url = URL.createObjectURL(pendingFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const pickFile = (file) => {
    if (!file) return;
    setPhotoError(null);
    if (!ACCEPTED.includes(file.type)) return setPhotoError('Photos must be a PNG, JPG or WEBP.');
    if (file.size > MAX_BYTES) return setPhotoError('That photo is over 5MB. Try a smaller one.');
    setPendingFile(file);
  };

  const clearPhoto = async () => {
    setPhotoError(null);
    setPendingFile(null);
    if (fileInput.current) fileInput.current.value = '';
    // An existing item's photo lives on the server; a not-yet-uploaded one
    // only ever existed in this dialog.
    if (item?.image_url && !pendingFile) await onRemoveImage(item.id);
    setPreview(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const body = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      category_id: categoryId === '' ? null : categoryId,
      price: Number(price),
      is_veg: isVeg === 'unspecified' ? null : isVeg === 'veg',
    };
    const saved = await onSave(body);
    if (!saved) return;

    // The item is saved either way; a photo that fails to upload keeps the
    // dialog open saying so, rather than closing on a half-done job.
    if (pendingFile) {
      const id = item?.id ?? saved?.item?.id;
      if (id && !(await onUploadImage(id, pendingFile))) {
        setPhotoError('The item was saved, but the photo did not upload. Try the photo again.');
        return;
      }
    }
    dialog.current.close();
  };

  return (
    <dialog
      ref={dialog}
      className={PANEL}
      aria-label={item ? `Edit ${item.name}` : 'Add menu item'}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current.close()}
    >
      <form className="max-h-[90dvh] overflow-y-auto p-6" onSubmit={submit}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-ink-900">{item ? 'Edit menu item' : 'Add menu item'}</h2>
            <p className="text-sm font-semibold text-ink-600">What a customer sees when they scan the table.</p>
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
          <span className={LABEL}>Item photo</span>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED.join(',')}
            className="sr-only"
            id="item-photo"
            aria-label="Item photo"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          {preview ? (
            <div className="relative overflow-hidden rounded-card border border-ink-200">
              <img src={preview} alt="" className="h-40 w-full bg-ink-100 object-cover" />
              <div className="absolute right-2 top-2 flex gap-2">
                <label
                  htmlFor="item-photo"
                  className="flex min-h-10 cursor-pointer items-center rounded-input bg-white/95 px-3 text-xs font-bold text-ink-800 hover:bg-paper"
                >
                  Replace
                </label>
                <button
                  type="button"
                  onClick={clearPhoto}
                  aria-label="Remove photo"
                  className="flex h-10 w-10 items-center justify-center rounded-input bg-white/95 text-danger-700 hover:bg-paper"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <label
              htmlFor="item-photo"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pickFile(e.dataTransfer.files?.[0]);
              }}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-card border-2 border-dashed border-ink-300 bg-ink-50 px-4 py-7 text-center hover:border-brand hover:bg-brand-50"
            >
              <ImagePlus className="h-6 w-6 text-ink-500" aria-hidden="true" />
              <span className="text-sm font-bold text-brand-700">Click to add a photo</span>
              <span className="text-xs font-semibold text-ink-600">PNG, JPG or WEBP · up to 5MB</span>
            </label>
          )}
          {photoError && (
            <p className="mt-1.5 text-xs font-bold text-danger-700" role="alert">
              {photoError}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label className={LABEL} htmlFor="item-name">
            Item name
          </label>
          <input
            id="item-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            autoFocus
            placeholder="e.g. Masala Chai"
            className={FIELD}
          />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL} htmlFor="item-price">
              Price (₹)
            </label>
            <input
              id="item-price"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              min="0"
              step="0.01"
              required
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="item-category">
              Category
            </label>
            <select id="item-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={FIELD}>
              <option value="">Uncategorised</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="mb-4">
          {/* Veg/non-veg is food-safety information, not decoration — see the
              .veg-mark note in docs/design.md. */}
          <legend className={LABEL}>Food type</legend>
          <div className="flex gap-2">
            {[
              ['veg', 'Veg', 'border-veg bg-veg/10 text-veg-ink'],
              ['nonveg', 'Non-veg', 'border-nonveg bg-nonveg/10 text-nonveg-ink'],
              ['unspecified', 'Not specified', 'border-ink-400 bg-ink-100 text-ink-800'],
            ].map(([value, label, active]) => (
              <label
                key={value}
                className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-input border-2 px-3 text-sm font-bold ${
                  isVeg === value ? active : 'border-ink-300 bg-paper text-ink-700 hover:bg-ink-50'
                }`}
              >
                <input
                  type="radio"
                  name="is_veg"
                  value={value}
                  checked={isVeg === value}
                  onChange={() => setIsVeg(value)}
                  className="sr-only"
                />
                {value !== 'unspecified' && (
                  <span className={`h-2.5 w-2.5 rounded-full ${value === 'veg' ? 'bg-veg' : 'bg-nonveg'}`} aria-hidden="true" />
                )}
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mb-5">
          <label className={LABEL} htmlFor="item-description">
            Description <span className="font-semibold text-ink-600">(optional)</span>
          </label>
          <textarea
            id="item-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Cutting chai, brewed strong with ginger and cardamom"
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
          {busy ? 'Saving…' : item ? 'Save changes' : 'Create menu item'}
        </button>
      </form>
    </dialog>
  );
}
