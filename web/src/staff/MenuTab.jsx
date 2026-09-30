import { useMemo, useState } from 'react';
import { Layers, Pencil, Plus, Search, Trash2, UtensilsCrossed } from 'lucide-react';
import { formatMoney } from '../format.js';
import { useMenuAdmin } from './useMenuAdmin.js';
import { ItemForm } from './ItemForm.jsx';
import { CategoryForm } from './CategoryForm.jsx';

// Owners get full add/edit/delete and the whole Categories view. Staff and the
// kitchen see the same items, but only the availability toggle — the one thing
// the original security model always meant for them ("the kitchen can 86 an
// item mid-service").
export function MenuTab({ isOwner, token }) {
  const menu = useMenuAdmin(token);
  const [view, setView] = useState('items'); // items | categories
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState(null); // null | 'new' | an item
  const [editingCategory, setEditingCategory] = useState(null); // null | 'new' | a category
  const [confirmingDelete, setConfirmingDelete] = useState(null); // item id
  const [confirmingCategoryDelete, setConfirmingCategoryDelete] = useState(null);

  const items = menu.items ?? [];
  const categories = menu.categories ?? [];

  // Name and description both, because "what had ginger in it again?" is a real
  // way to look for a dish you half-remember.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.name} ${i.description ?? ''}`.toLowerCase().includes(q));
  }, [items, search]);

  if (menu.items === null && !menu.error) {
    return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading the menu…</p>;
  }

  const saveItem = (body) => (editingItem === 'new' ? menu.createItem(body) : menu.updateItem(editingItem.id, body));
  const saveCategory = (body) =>
    editingCategory === 'new' ? menu.createCategory(body) : menu.updateCategory(editingCategory.id, body);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {menu.error && (
          <div
            className="flex items-center justify-between gap-3 rounded-card border border-danger-200 bg-danger-50 px-4 py-2.5 text-sm font-semibold text-danger-700"
            role="alert"
          >
            <span>{menu.error}</span>
            <button type="button" onClick={menu.dismissError} aria-label="Dismiss" className="text-lg leading-none">
              ×
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-ink-200 bg-paper p-6">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Menu &amp; catalog</h2>
            <p className="text-sm font-semibold text-ink-600">
              {items.length} {items.length === 1 ? 'item' : 'items'} · {categories.length}{' '}
              {categories.length === 1 ? 'category' : 'categories'}
              {items.some((i) => !i.is_available) && ` · ${items.filter((i) => !i.is_available).length} 86'd`}
            </p>
          </div>
          {isOwner && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditingCategory('new')}
                className="flex min-h-12 items-center gap-1.5 rounded-card border-2 border-ink-300 px-4 text-sm font-bold text-ink-700 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.98]"
              >
                <Layers className="h-4 w-4" aria-hidden="true" /> New category
              </button>
              <button
                type="button"
                onClick={() => setEditingItem('new')}
                className="flex items-center gap-1.5 rounded-card min-h-12 bg-brand px-4 text-sm font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> New menu item
              </button>
            </div>
          )}
        </div>

        {isOwner && (
          <div className="flex gap-1 rounded-card bg-ink-100 p-1" role="tablist">
            {[
              ['items', 'Menu items', UtensilsCrossed],
              ['categories', 'Categories', Layers],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`flex min-h-10 items-center gap-1.5 rounded-input px-4 text-sm font-bold transition-colors duration-150 ease-tap ${
                  view === id ? 'bg-brand text-white' : 'text-ink-700 hover:bg-paper'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        )}

        {view === 'items' || !isOwner ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dishes…"
                aria-label="Search dishes"
                className="min-h-12 w-full max-w-md rounded-input border border-ink-300 bg-paper py-2.5 pl-9 pr-3 text-sm font-semibold text-ink-900 placeholder:font-normal placeholder:text-ink-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>

            {visible.length === 0 ? (
              <EmptyState
                search={search}
                hasItems={items.length > 0}
                isOwner={isOwner}
                onAdd={() => setEditingItem('new')}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    isOwner={isOwner}
                    busy={menu.busyId === item.id}
                    confirming={confirmingDelete === item.id}
                    onEdit={() => setEditingItem(item)}
                    onAskDelete={() => setConfirmingDelete(item.id)}
                    onCancelDelete={() => setConfirmingDelete(null)}
                    onConfirmDelete={async () => {
                      await menu.deleteItem(item.id);
                      setConfirmingDelete(null);
                    }}
                    onToggle={(next) => menu.setAvailability(item.id, next)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <CategoryList
            categories={categories}
            uncategorised={items.filter((i) => i.category_id === null).length}
            busyId={menu.busyId}
            confirming={confirmingCategoryDelete}
            onEdit={setEditingCategory}
            onAskDelete={setConfirmingCategoryDelete}
            onCancelDelete={() => setConfirmingCategoryDelete(null)}
            onConfirmDelete={async (id) => {
              await menu.deleteCategory(id);
              setConfirmingCategoryDelete(null);
            }}
            onAdd={() => setEditingCategory('new')}
          />
        )}
      </div>

      {editingItem && (
        <ItemForm
          item={editingItem === 'new' ? null : editingItem}
          categories={categories}
          busy={menu.busyId === (editingItem === 'new' ? 'new' : editingItem.id)}
          error={menu.error}
          onSave={saveItem}
          onUploadImage={menu.uploadImage}
          onRemoveImage={menu.removeImage}
          onClose={() => setEditingItem(null)}
        />
      )}

      {editingCategory && (
        <CategoryForm
          category={editingCategory === 'new' ? null : editingCategory}
          busy={menu.busyId === (editingCategory === 'new' ? 'new-category' : editingCategory.id)}
          error={menu.error}
          onSave={saveCategory}
          onClose={() => setEditingCategory(null)}
        />
      )}
    </div>
  );
}

// A photo when there is one, a two-letter monogram when there isn't — the same
// one treatment for every item, not a per-category colour, which docs/design.md
// rules out as decoration rather than information.
function ItemCard({ item, isOwner, busy, confirming, onEdit, onAskDelete, onCancelDelete, onConfirmDelete, onToggle }) {
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-card border border-ink-200 bg-paper ${
        item.is_available ? '' : 'opacity-70'
      }`}
    >
      <div className="relative h-32 bg-ink-100">
        {item.image_url ? (
          <img src={item.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-input bg-butter-300 font-display text-base font-extrabold text-ink-900">
              {monogram(item.name)}
            </span>
          </div>
        )}

        <span className="absolute bottom-2 left-2 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-ink-800 ">
          {item.category}
        </span>

        {!item.is_available && (
          <span className="absolute right-2 top-2 rounded-full bg-danger-500 px-2.5 py-1 text-xs font-bold text-white">86'd</span>
        )}

        {isOwner && !confirming && (
          <div className="absolute left-2 top-2 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${item.name}`}
              className="flex h-10 w-10 items-center justify-center rounded-input bg-white/95 text-ink-700 hover:bg-paper hover:text-brand-700"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onAskDelete}
              aria-label={`Delete ${item.name}`}
              className="flex h-10 w-10 items-center justify-center rounded-input bg-white/95 text-ink-700 hover:bg-paper hover:text-danger-700"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
            {item.is_veg !== null && (
              <span
                className={`h-2.5 w-2.5 flex-none rounded-full ${item.is_veg ? 'bg-veg' : 'bg-nonveg'}`}
                role="img"
                aria-label={item.is_veg ? 'Veg' : 'Non-veg'}
              />
            )}
            {item.name}
          </h3>
          <span className="flex-none font-mono text-sm font-bold text-ink-900">{formatMoney(item.price)}</span>
        </div>

        {item.description && <p className="mt-1 line-clamp-2 text-xs font-semibold text-ink-600">{item.description}</p>}

        <div className="mt-3 flex-1" />

        {confirming ? (
          <div className="rounded-card bg-danger-50 p-2.5">
            <p className="mb-2 text-xs font-bold text-danger-700">Delete {item.name}?</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancelDelete}
                className="min-h-11 flex-1 rounded-input border-2 border-ink-300 bg-paper px-3 text-sm font-bold text-ink-800 hover:bg-ink-50"
              >
                Keep it
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirmDelete}
                className="min-h-11 flex-1 rounded-input bg-danger-500 px-3 text-sm font-bold text-white hover:bg-danger-600 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          // 86'ing is the one action the kitchen has here, so it is the one
          // control on the card that isn't owner-gated.
          <label className="flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-card bg-ink-50 px-3 py-2">
            <span className={`text-xs font-bold ${item.is_available ? 'text-ink-800' : 'text-danger-700'}`}>
              {item.is_available ? 'Available' : "86'd"}
            </span>
            <input
              type="checkbox"
              checked={item.is_available}
              disabled={busy}
              onChange={(e) => onToggle(e.target.checked)}
              className="h-5 w-5 rounded accent-brand disabled:opacity-50"
            />
          </label>
        )}
      </div>
    </div>
  );
}

function CategoryList({
  categories,
  uncategorised,
  busyId,
  confirming,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onAdd,
}) {
  if (categories.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-ink-300 bg-paper p-10 text-center">
        <Layers className="mx-auto mb-2 h-8 w-8 text-ink-500" aria-hidden="true" />
        <p className="text-sm font-bold text-ink-900">No categories yet</p>
        <p className="mb-4 text-sm font-semibold text-ink-600">
          Sections group the menu a customer scrolls. Everything sits under Uncategorised until you add one.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-card min-h-12 bg-brand px-4 text-sm font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98]"
        >
          Add the first category
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-ink-200 bg-paper">
      {categories.map((c) => (
        <div key={c.id} className="flex items-center gap-3 border-b border-ink-200 p-4 last:border-b-0">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-input bg-butter-300 font-mono text-sm font-bold text-ink-900">
            {c.display_order}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-ink-900">{c.name}</div>
            <div className="text-xs font-semibold text-ink-600">
              {c.item_count} {c.item_count === 1 ? 'item' : 'items'}
            </div>
          </div>

          {confirming === c.id ? (
            <div className="flex flex-none items-center gap-2">
              {/* Says what actually happens to the food, because "delete" next
                  to a category holding 12 dishes reads like it takes them too. */}
              <span className="text-xs font-bold text-ink-900">
                {c.item_count > 0 ? `Move ${c.item_count} to Uncategorised?` : 'Delete this category?'}
              </span>
              <button
                type="button"
                onClick={onCancelDelete}
                className="min-h-11 rounded-input border-2 border-ink-300 px-3 text-sm font-bold text-ink-800 hover:bg-ink-50"
              >
                Keep
              </button>
              <button
                type="button"
                disabled={busyId === c.id}
                onClick={() => onConfirmDelete(c.id)}
                className="min-h-11 rounded-input bg-danger-500 px-3 text-sm font-bold text-white hover:bg-danger-600 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          ) : (
            <div className="flex flex-none items-center gap-1.5">
              <button
                type="button"
                onClick={() => onEdit(c)}
                aria-label={`Edit ${c.name}`}
                className="flex h-11 w-11 items-center justify-center rounded-input text-ink-600 hover:bg-ink-100 hover:text-brand-700"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onAskDelete(c.id)}
                aria-label={`Delete ${c.name}`}
                className="flex h-11 w-11 items-center justify-center rounded-input text-ink-600 hover:bg-ink-100 hover:text-danger-700"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      ))}

      {uncategorised > 0 && (
        <div className="flex items-center gap-3 border-t border-ink-200 bg-ink-50 p-4">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-card bg-ink-200 text-sm font-bold text-ink-700">
            —
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-ink-900">Uncategorised</div>
            <div className="text-xs font-semibold text-ink-600">
              {uncategorised} {uncategorised === 1 ? 'item' : 'items'} · reads last on the customer's menu
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ search, hasItems, isOwner, onAdd }) {
  if (search && hasItems) {
    return (
      <div className="rounded-card border border-dashed border-ink-300 bg-paper p-10 text-center">
        <Search className="mx-auto mb-2 h-8 w-8 text-ink-500" aria-hidden="true" />
        <p className="text-sm font-bold text-ink-900">Nothing matches “{search}”</p>
        <p className="text-sm font-semibold text-ink-600">Try a shorter word, or part of the description.</p>
      </div>
    );
  }
  return (
    <div className="rounded-card border border-dashed border-ink-300 bg-paper p-10 text-center">
      <UtensilsCrossed className="mx-auto mb-2 h-8 w-8 text-ink-500" aria-hidden="true" />
      <p className="text-sm font-bold text-ink-900">No menu items yet</p>
      <p className="mb-4 text-sm font-semibold text-ink-600">
        {isOwner ? 'Add the first dish and it appears on every table’s QR menu straight away.' : 'The owner has not added anything yet.'}
      </p>
      {isOwner && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded-card min-h-12 bg-brand px-4 text-sm font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98]"
        >
          Add the first item
        </button>
      )}
    </div>
  );
}

// Initials from the first two words that actually start with a letter, so
// "Samosa (2 pcs)" reads SP rather than "S(" — a real menu is full of counts
// and brackets. Falls back to the first usable character for a name that is
// all digits or punctuation.
const monogram = (name) => {
  const initials = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return initials || name.replace(/[^\p{L}\p{N}]/gu, '')[0]?.toUpperCase() || '?';
};
