import { useMemo, useState } from 'react';
import { Search, Plus, Minus, X, ShoppingCart, Users, LogOut, Clock } from 'lucide-react';
import { usePOS } from './usePOS.js';
import { ageMinutes } from './age.js';
import { formatMoney } from '../format.js';
import { VegMark } from '../components/VegMark.jsx';

// Free/occupied only communicate table status — see docs/design.md. A third
// "pending" (amber) state is reserved there for later (e.g. bill requested)
// but not used yet.
const STATUS_CARD = {
  free: 'border-emerald-300 bg-emerald-50 hover:border-emerald-400',
  occupied: 'border-red-300 bg-red-50 hover:border-red-400',
};
const STATUS_BADGE = {
  free: 'bg-emerald-100 text-emerald-800',
  occupied: 'bg-red-100 text-red-800',
};

// GET /floor has no server_time of its own, so this trusts the device clock
// (unlike the order board, which corrects for skew — see age.js). A table's
// "occupied for" is a rough at-a-glance number, not a kitchen timer.
function occupiedFor(placedAt) {
  const mins = ageMinutes(placedAt, 0);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function initials(name) {
  const words = name.split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, '')).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

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
  const occupiedCount = pos.tables?.filter((t) => t.status === 'occupied').length ?? 0;
  const freeCount = pos.tables?.filter((t) => t.status === 'free').length ?? 0;

  if (pos.tables === null && pos.items === null) {
    return <p className="p-10 text-center text-sm font-semibold text-gray-700">Loading the floor…</p>;
  }

  return (
    <div className="flex min-h-0 flex-1">
      {pos.error && (
        <div className="absolute inset-x-0 top-0 z-10 mx-6 mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800" role="alert">
          <span>{pos.error}</span>
          <button type="button" onClick={pos.dismissError} aria-label="Dismiss" className="text-lg leading-none">
            ×
          </button>
        </div>
      )}

      {/* Floor map */}
      <div className="w-80 flex-none overflow-y-auto border-r border-gray-200 bg-white p-4">
        <h2 className="text-base font-bold text-gray-900">Floor</h2>
        <div className="mb-4 mt-3 flex gap-2">
          <span className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-800">
            {occupiedCount} Occupied
          </span>
          <span className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
            {freeCount} Free
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(pos.tables ?? []).map((t) => {
            // Checkout only ever touches served orders (see tables.js) — only
            // offer it when it would actually do something, not for a table
            // that's still busy with the kitchen.
            const canCheckout = t.status === 'occupied' && t.active_order?.status === 'served';
            const selected = pos.selectedTableId === t.id;
            return (
              <div
                key={t.id}
                className={`rounded-2xl border p-3 transition-colors ${
                  selected ? 'border-teal-600 bg-teal-600 shadow-md' : STATUS_CARD[t.status]
                }`}
              >
                <button type="button" onClick={() => pos.selectTable(t.id)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-1">
                    <span className={`text-sm font-bold ${selected ? 'text-white' : 'text-gray-900'}`}>{t.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        selected ? 'bg-white/20 text-white' : STATUS_BADGE[t.status]
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                  {t.seats != null && (
                    <div className={`mt-1 flex items-center gap-1 text-xs font-semibold ${selected ? 'text-teal-50' : 'text-gray-600'}`}>
                      <Users className="h-3.5 w-3.5" aria-hidden="true" /> {t.seats} seats
                    </div>
                  )}
                  {t.active_order && (
                    <div className={`mt-2 rounded-lg px-2 py-1.5 ${selected ? 'bg-white/15' : 'bg-white'}`}>
                      <div className={`text-xs font-bold ${selected ? 'text-white' : 'text-gray-900'}`}>
                        #{t.active_order.order_number}
                      </div>
                      <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold ${selected ? 'text-teal-50' : 'text-gray-600'}`}>
                        <Clock className="h-3 w-3" aria-hidden="true" /> {occupiedFor(t.active_order.placed_at)}
                      </div>
                    </div>
                  )}
                </button>
                {canCheckout && (
                  <button
                    type="button"
                    onClick={() => pos.checkoutTable(t.id)}
                    disabled={pos.checkingOut === t.id}
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white py-1.5 text-xs font-bold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    {pos.checkingOut === t.id ? 'Checking out…' : 'Checkout'}
                  </button>
                )}
              </div>
            );
          })}
          {pos.tables?.length === 0 && <p className="col-span-2 text-sm font-semibold text-gray-700">No tables yet.</p>}
        </div>
      </div>

      {/* Menu */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-col gap-3 border-b border-gray-200 bg-white p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              aria-label="Search items"
              className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm font-semibold text-gray-900 outline-none placeholder:font-medium placeholder:text-gray-500 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`flex-none rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
                  category === c ? 'bg-teal-600 text-white shadow-sm' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
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
              className="flex flex-col items-start gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-sm font-bold text-teal-700"
                aria-hidden="true"
              >
                {initials(item.name)}
              </span>
              <span className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                <VegMark isVeg={item.is_veg} /> {item.name}
              </span>
              <span className="text-xs font-semibold text-gray-600">{item.category}</span>
              <span className="text-base font-bold text-teal-700">{formatMoney(item.price)}</span>
            </button>
          ))}
          {pos.items !== null && visibleItems.length === 0 && (
            <p className="col-span-full text-sm font-semibold text-gray-700">No items match.</p>
          )}
        </div>
      </div>

      {/* Cart */}
      <div className="flex w-96 flex-none flex-col border-l border-gray-200 bg-white">
        <div className="flex flex-none items-center justify-between gap-2 bg-teal-600 px-4 py-4">
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <ShoppingCart className="h-5 w-5" aria-hidden="true" /> Order
          </div>
          {selectedTable && (
            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              {selectedTable.label}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selectedTable ? (
            <div className="mt-10 text-center">
              <ShoppingCart className="mx-auto h-10 w-10 text-gray-400" aria-hidden="true" />
              <p className="mt-3 text-sm font-bold text-gray-800">Select a table to start an order.</p>
            </div>
          ) : pos.cart.length === 0 ? (
            <div className="mt-10 text-center">
              <ShoppingCart className="mx-auto h-10 w-10 text-gray-400" aria-hidden="true" />
              <p className="mt-3 text-sm font-bold text-gray-800">No items yet</p>
              <p className="mt-1 text-sm font-semibold text-gray-600">Tap a menu item to add it.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pos.cart.map((line) => (
                <li key={line.menu_item_id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 p-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-gray-900">{line.name}</div>
                    <div className="text-xs font-semibold text-gray-600">{formatMoney(line.price)}</div>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${line.name}`}
                      onClick={() => pos.setQuantity(line.menu_item_id, line.quantity - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      {line.quantity === 1 ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                    <span className="w-4 text-center text-sm font-bold tabular-nums text-gray-900">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${line.name}`}
                      onClick={() => pos.setQuantity(line.menu_item_id, line.quantity + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
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
          <div className="mb-3 flex items-center justify-between rounded-xl bg-gray-100 px-4 py-3">
            <span className="text-sm font-bold text-gray-700">Subtotal</span>
            <span className="text-xl font-bold text-gray-900">{formatMoney(pos.subtotal)}</span>
          </div>
          <button
            type="button"
            disabled={!selectedTable || pos.cart.length === 0 || pos.placing}
            onClick={pos.sendToKitchen}
            className="w-full rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pos.placing ? 'Sending…' : 'Send to kitchen'}
          </button>
        </div>
      </div>
    </div>
  );
}
