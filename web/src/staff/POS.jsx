import { useMemo, useState } from 'react';
import { Search, Plus, Minus, X, ShoppingCart, Users, LogOut } from 'lucide-react';
import { usePOS } from './usePOS.js';
import { formatMoney } from '../format.js';
import { VegMark } from '../components/VegMark.jsx';

// Free/occupied only communicate table status — see docs/design.md. A third
// "pending" (amber) state is reserved there for later (e.g. bill requested)
// but not used yet.
const STATUS_CARD = {
  free: 'border-emerald-200 bg-emerald-50/60 hover:border-emerald-300',
  occupied: 'border-red-200 bg-red-50/60 hover:border-red-300',
};
const STATUS_BADGE = {
  free: 'bg-emerald-100 text-emerald-700',
  occupied: 'bg-red-100 text-red-700',
};

export function POS({ token }) {
  const pos = usePOS(token);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  const categories = useMemo(() => {
    if (!pos.items) return ['All'];
    return ['All', ...new Set(pos.items.map((i) => i.category))];
  }, [pos.items]);

  const visibleItems = useMemo(() => {
    if (!pos.items) return [];
    return pos.items.filter((i) => {
      const inCategory = category === 'All' || i.category === category;
      const matchesSearch = i.name.toLowerCase().includes(search.trim().toLowerCase());
      return inCategory && matchesSearch;
    });
  }, [pos.items, category, search]);

  const selectedTable = pos.tables?.find((t) => t.id === pos.selectedTableId) ?? null;

  if (pos.tables === null && pos.items === null) {
    return <p className="p-10 text-center text-sm text-gray-500">Loading the floor…</p>;
  }

  return (
    <div className="flex min-h-0 flex-1">
      {pos.error && (
        <div className="absolute inset-x-0 top-0 z-10 mx-6 mt-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700" role="alert">
          <span>{pos.error}</span>
          <button type="button" onClick={pos.dismissError} aria-label="Dismiss" className="text-lg leading-none">
            ×
          </button>
        </div>
      )}

      {/* Floor map */}
      <div className="w-72 flex-none overflow-y-auto border-r border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Floor</h2>
        <div className="grid grid-cols-2 gap-3">
          {(pos.tables ?? []).map((t) => {
            // Checkout only ever touches served orders (see tables.js) — only
            // offer it when it would actually do something, not for a table
            // that's still busy with the kitchen.
            const canCheckout = t.status === 'occupied' && t.active_order?.status === 'served';
            return (
              <div
                key={t.id}
                className={`rounded-2xl border p-3 transition-colors ${STATUS_CARD[t.status]} ${
                  pos.selectedTableId === t.id ? 'ring-2 ring-teal-500' : ''
                }`}
              >
                <button type="button" onClick={() => pos.selectTable(t.id)} className="w-full text-left">
                  <div className="text-sm font-semibold text-gray-900">{t.label}</div>
                  {t.seats != null && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                      <Users className="h-3 w-3" aria-hidden="true" /> {t.seats}
                    </div>
                  )}
                  <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_BADGE[t.status]}`}>
                    {t.status}
                  </span>
                </button>
                {canCheckout && (
                  <button
                    type="button"
                    onClick={() => pos.checkoutTable(t.id)}
                    disabled={pos.checkingOut === t.id}
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <LogOut className="h-3 w-3" aria-hidden="true" />
                    {pos.checkingOut === t.id ? 'Checking out…' : 'Checkout'}
                  </button>
                )}
              </div>
            );
          })}
          {pos.tables?.length === 0 && <p className="col-span-2 text-sm text-gray-400">No tables yet.</p>}
        </div>
      </div>

      {/* Menu */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-col gap-3 border-b border-gray-200 bg-white p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              aria-label="Search items"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-gray-900 outline-none focus:border-teal-400 focus:bg-white focus:ring-1 focus:ring-teal-400"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`flex-none rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  category === c ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4 lg:grid-cols-3">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pos.addItem(item)}
              className="flex flex-col items-start gap-1 rounded-2xl border border-gray-200 bg-white p-3.5 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <VegMark isVeg={item.is_veg} /> {item.name}
              </span>
              <span className="text-xs text-gray-400">{item.category}</span>
              <span className="mt-1 text-sm font-semibold text-teal-700">{formatMoney(item.price)}</span>
            </button>
          ))}
          {pos.items !== null && visibleItems.length === 0 && (
            <p className="col-span-full text-sm text-gray-400">No items match.</p>
          )}
        </div>
      </div>

      {/* Cart */}
      <div className="flex w-96 flex-none flex-col border-l border-gray-200 bg-white">
        <div className="flex flex-none items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <ShoppingCart className="h-4 w-4 text-gray-400" aria-hidden="true" /> Order
          </div>
          {selectedTable && (
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">{selectedTable.label}</span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selectedTable ? (
            <p className="mt-10 text-center text-sm text-gray-400">Select a table to start an order.</p>
          ) : pos.cart.length === 0 ? (
            <p className="mt-10 text-center text-sm text-gray-400">No items yet — tap a menu item to add it.</p>
          ) : (
            <ul className="space-y-3">
              {pos.cart.map((line) => (
                <li key={line.menu_item_id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-900">{line.name}</div>
                    <div className="text-xs text-gray-500">{formatMoney(line.price)}</div>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${line.name}`}
                      onClick={() => pos.setQuantity(line.menu_item_id, line.quantity - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50"
                    >
                      {line.quantity === 1 ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                    <span className="w-4 text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${line.name}`}
                      onClick={() => pos.setQuantity(line.menu_item_id, line.quantity + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-none border-t border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="font-semibold text-gray-900">{formatMoney(pos.subtotal)}</span>
          </div>
          <button
            type="button"
            disabled={!selectedTable || pos.cart.length === 0 || pos.placing}
            onClick={pos.sendToKitchen}
            className="w-full rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 py-3 text-sm font-semibold text-white shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pos.placing ? 'Sending…' : 'Send to kitchen'}
          </button>
        </div>
      </div>
    </div>
  );
}
