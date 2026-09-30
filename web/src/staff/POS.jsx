import { useMemo, useState } from 'react';
import { Search, Plus, Minus, X, ShoppingCart, Users, Clock, LayoutGrid, QrCode, ReceiptText, Check, XCircle } from 'lucide-react';
import { usePOS } from './usePOS.js';
import { compactLayout } from './floorLayout.js';
import { ageMinutes } from './age.js';
import { formatMoney } from '../format.js';
import { VegMark } from '../components/VegMark.jsx';
import { CheckoutDialog } from './CheckoutDialog.jsx';
import { StatusPill } from '../brand/StatusPill.jsx';

// Free/occupied only communicate table status — see docs/design.md. Free is
// the brand's "ready" green. Occupied is a crimson TINT, not the brand's danger
// red: a busy table is not an error, and the brand keeps danger and crimson
// apart. The selected table is solid crimson, so tint and solid never collide.
const STATUS_CARD = {
  free: 'border-ready-ink/30 bg-ready hover:border-ready-ink/60',
  occupied: 'border-brand-200 bg-brand-50 hover:border-brand-300',
};
const STATUS_BADGE = {
  free: 'bg-ready-ink/15 text-ready-ink',
  occupied: 'bg-brand-100 text-brand-700',
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
  const [floorTab, setFloorTab] = useState('floor'); // floor | qr
  const [orderTab, setOrderTab] = useState('cart'); // cart | ongoing

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
  // Two columns is what this panel can show a readable card in; a wider plan
  // flows instead of being drawn (see floorLayout.js).
  const floorGrid = compactLayout(pos.tables ?? [], { maxColumns: 2 });
  const outstanding = Number(selectedTable?.unpaid_total ?? 0);
  const pendingCount = pos.pending?.length ?? 0;

  if (pos.tables === null && pos.items === null) {
    return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading the floor…</p>;
  }

  return (
    // relative: the error banner below is absolutely positioned, and without a
    // positioned ancestor it anchors to the document instead of to POS — which
    // put failures somewhere nobody was looking.
    <div className="relative flex min-h-0 flex-1">
      {pos.error && (
        <div className="absolute inset-x-0 top-0 z-10 mx-6 mt-4 flex items-center justify-between gap-3 rounded-card border border-danger-200 bg-danger-50 px-4 py-2.5 text-sm font-semibold text-danger-700" role="alert">
          <span>{pos.error}</span>
          <button type="button" onClick={pos.dismissError} aria-label="Dismiss" className="text-lg leading-none">
            ×
          </button>
        </div>
      )}

      {/* Floor / QR */}
      <div className="flex w-80 flex-none flex-col overflow-hidden border-r border-ink-200 bg-paper">
        <div className="flex flex-none gap-1 p-3">
          {[
            { id: 'floor', label: 'Floor', Icon: LayoutGrid, count: 0 },
            { id: 'qr', label: 'QR', Icon: QrCode, count: pendingCount },
          ].map(({ id, label, Icon, count }) => (
            <button
              key={id}
              type="button"
              aria-current={floorTab === id}
              onClick={() => setFloorTab(id)}
              className={`flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-card px-3 text-sm font-bold transition-colors duration-150 ease-tap ${
                floorTab === id ? 'bg-brand text-white' : 'text-ink-700 hover:bg-ink-100'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs font-bold ${
                    floorTab === id ? 'bg-white/25 text-white' : 'bg-placed-ink text-white'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {floorTab === 'floor' ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <div className="mb-4 flex gap-2">
              <span className="rounded-card border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">
                {occupiedCount} Occupied
              </span>
              <span className="rounded-card border border-ready-ink/30 bg-ready px-3 py-1.5 text-xs font-bold text-ready-ink">
                {freeCount} Free
              </span>
            </div>

            {/* The owner's own arrangement from Settings -> Seating Plan, so the
                till shows the room the way it actually is. Compacted, because
                these cards carry a running total and a sitting time and can't
                shrink to a twelfth of the panel — see floorLayout.js. */}
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${floorGrid.columns}, minmax(0, 1fr))` }}>
              {(pos.tables ?? []).map((t) => {
                const selected = pos.selectedTableId === t.id;
                const cell = floorGrid.cellOf(t);
                return (
                  <div
                    key={t.id}
                    style={cell ? { gridColumn: cell.column, gridRow: cell.row } : undefined}
                    className={`rounded-card border p-3 transition-colors ${
                      selected ? 'border-brand bg-brand' : STATUS_CARD[t.status]
                    }`}
                  >
                    <button type="button" onClick={() => pos.selectTable(t.id)} className="w-full text-left">
                      <div className="flex items-start justify-between gap-1">
                        <span className={`font-display text-base font-extrabold ${selected ? 'text-white' : 'text-ink-900'}`}>{t.label}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${
                            selected ? 'bg-white/20 text-white' : STATUS_BADGE[t.status]
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                      {t.seats != null && (
                        <div className={`mt-1 flex items-center gap-1 text-xs font-semibold ${selected ? 'text-brand-50' : 'text-ink-600'}`}>
                          <Users className="h-3.5 w-3.5" aria-hidden="true" /> {t.seats} seats
                        </div>
                      )}
                      {t.active_order && (
                        <div className={`mt-2 rounded-input px-2 py-1.5 ${selected ? 'bg-white/15' : 'bg-paper'}`}>
                          <div className={`font-mono text-sm font-bold ${selected ? 'text-white' : 'text-ink-900'}`}>
                            {formatMoney(t.unpaid_total)}
                          </div>
                          <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold ${selected ? 'text-brand-50' : 'text-ink-600'}`}>
                            <Clock className="h-3 w-3" aria-hidden="true" /> {occupiedFor(t.active_order.placed_at)}
                            {t.unpaid_count > 1 && <span>· {t.unpaid_count} orders</span>}
                          </div>
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
              {pos.tables?.length === 0 && <p className="text-sm font-semibold text-ink-700">No tables yet.</p>}
            </div>
          </div>
        ) : (
          <PendingQueue pos={pos} />
        )}
      </div>

      {/* Menu */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-col gap-3 border-b border-ink-200 bg-paper p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              aria-label="Search items"
              className="min-h-12 w-full rounded-input border border-ink-300 bg-paper py-2.5 pl-9 pr-3 text-sm font-semibold text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-500 focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`flex-none rounded-full px-4 py-2 text-sm font-bold transition-colors duration-150 ease-tap ${
                  category === c ? 'bg-brand text-white' : 'border border-ink-300 bg-paper text-ink-700 hover:bg-ink-50'
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
              className="flex flex-col items-start gap-2 rounded-card border border-ink-200 bg-paper p-4 text-left transition duration-150 ease-tap hover:border-brand-300 active:scale-[0.98]"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-input bg-butter-300 font-display text-sm font-extrabold text-ink-900"
                aria-hidden="true"
              >
                {initials(item.name)}
              </span>
              <span className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
                <VegMark isVeg={item.is_veg} /> {item.name}
              </span>
              <span className="text-xs font-semibold text-ink-600">{item.category}</span>
              <span className="font-mono text-base font-bold text-ink-900">{formatMoney(item.price)}</span>
            </button>
          ))}
          {pos.items !== null && visibleItems.length === 0 && (
            <p className="col-span-full text-sm font-semibold text-ink-700">No items match.</p>
          )}
        </div>
      </div>

      {/* Order */}
      <div className="flex w-96 flex-none flex-col border-l border-ink-200 bg-paper">
        <div className="flex flex-none items-center justify-between gap-2 bg-brand px-4 py-4">
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <ShoppingCart className="h-5 w-5" aria-hidden="true" /> Order
          </div>
          {selectedTable && (
            <span className="rounded-full bg-white/20 px-3 py-1 font-mono text-xs font-bold uppercase tracking-wide text-white">
              {selectedTable.label}
            </span>
          )}
        </div>

        {selectedTable && (
          <div className="flex flex-none gap-1 border-b border-ink-200 p-2">
            {[
              { id: 'cart', label: `Cart${pos.cart.length ? ` (${pos.cart.length})` : ''}` },
              { id: 'ongoing', label: `Ongoing${selectedTable.unpaid_count ? ` (${selectedTable.unpaid_count})` : ''}` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={orderTab === t.id}
                onClick={() => setOrderTab(t.id)}
                className={`min-h-12 flex-1 rounded-card text-sm font-bold transition-colors duration-150 ease-tap ${
                  orderTab === t.id ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {selectedTable && outstanding > 0 && (
          <div className="flex-none border-b border-butter-500 bg-butter-100 px-4 py-2.5">
            <p className="text-xs font-bold text-ink-900">
              {selectedTable.unpaid_count} unpaid {selectedTable.unpaid_count === 1 ? 'order' : 'orders'} on this table
            </p>
            <p className="text-sm font-bold text-ink-900">
              Running total: <span className="font-mono">{formatMoney(selectedTable.unpaid_total)}</span>
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {!selectedTable ? (
            <div className="mt-10 text-center">
              <ShoppingCart className="mx-auto h-10 w-10 text-ink-500" aria-hidden="true" />
              <p className="mt-3 text-sm font-bold text-ink-800">Select a table to start an order.</p>
            </div>
          ) : orderTab === 'ongoing' ? (
            <OngoingOrders table={selectedTable} />
          ) : pos.cart.length === 0 ? (
            <div className="mt-10 text-center">
              <ShoppingCart className="mx-auto h-10 w-10 text-ink-500" aria-hidden="true" />
              <p className="mt-3 text-sm font-bold text-ink-800">No items yet</p>
              <p className="mt-1 text-sm font-semibold text-ink-600">Tap a menu item to add it.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pos.cart.map((line) => (
                <li key={line.menu_item_id} className="flex items-center justify-between gap-2 rounded-card border border-ink-200 p-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-ink-900">{line.name}</div>
                    <div className="font-mono text-xs font-semibold text-ink-600">{formatMoney(line.price)}</div>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${line.name}`}
                      onClick={() => pos.setQuantity(line.menu_item_id, line.quantity - 1)}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-300 text-ink-700 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.95]"
                    >
                      {line.quantity === 1 ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                    <span className="w-5 text-center font-mono text-sm font-bold tabular-nums text-ink-900">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${line.name}`}
                      onClick={() => pos.setQuantity(line.menu_item_id, line.quantity + 1)}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-ink-300 text-ink-700 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.95]"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-none space-y-2 border-t border-ink-200 p-4">
          <div className="flex items-center justify-between rounded-card bg-ink-100 px-4 py-3">
            <span className="text-sm font-bold text-ink-700">{pos.cart.length ? 'This order' : 'Subtotal'}</span>
            <span className="font-mono text-xl font-bold text-ink-900">{formatMoney(pos.subtotal)}</span>
          </div>
          <button
            type="button"
            disabled={!selectedTable || pos.cart.length === 0 || pos.placing}
            onClick={pos.sendToKitchen}
            className="min-h-12 w-full rounded-card bg-brand py-3 text-sm font-bold uppercase tracking-wide text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pos.placing ? 'Sending…' : 'Send to kitchen'}
          </button>
          {selectedTable && outstanding > 0 && (
            <button
              type="button"
              onClick={() => pos.openBill(selectedTable.id)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-card bg-butter-300 py-3 text-sm font-bold uppercase tracking-wide text-ink-900 transition duration-150 ease-tap hover:bg-butter-100 active:scale-[0.98]"
            >
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
              Bill &amp; checkout · {formatMoney(selectedTable.unpaid_total)}
            </button>
          )}
        </div>
      </div>

      {pos.bill && (
        <CheckoutDialog
          bill={pos.bill}
          busy={pos.checkingOut === pos.bill.table.id}
          onClose={pos.closeBill}
          onConfirm={({ method, idempotencyKey }) => pos.checkoutTable(pos.bill.table.id, { method, idempotencyKey })}
        />
      )}
    </div>
  );
}

// What the table has already sent to the kitchen and not yet paid for, so the
// counter can answer "what did we order?" without leaving the till. Read
// straight off the floor payload — no extra request for a panel this small.
function OngoingOrders({ table }) {
  if (!table.active_order) {
    return <p className="mt-10 text-center text-sm font-bold text-ink-800">Nothing ordered yet.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="rounded-card border border-ink-200 p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-bold text-ink-900">#{table.active_order.order_number}</span>
          <StatusPill status={table.active_order.status} label={table.active_order.status} className="capitalize" />
        </div>
        <p className="mt-1 text-xs font-semibold text-ink-600">
          Placed {occupiedFor(table.active_order.placed_at)} ago
        </p>
      </div>
      {table.unpaid_count > 1 && (
        <p className="text-xs font-semibold text-ink-600">
          {table.unpaid_count - 1} earlier {table.unpaid_count - 1 === 1 ? 'order' : 'orders'} also unpaid — the full
          breakdown is in Bill &amp; checkout.
        </p>
      )}
    </div>
  );
}

// QR orders wait here for someone at the counter to accept them before the
// kitchen ever sees them. Approve sends it through exactly as a staff-placed
// order would go; Reject cancels it, recorded like any other cancellation.
//
// (The Tables tab still owns the printable QR *codes* — this tab is the queue
// those codes feed, which is what the reference POS uses the slot for.)
function PendingQueue({ pos }) {
  if (pos.pending === null) {
    return <p className="px-4 text-sm font-semibold text-ink-700">Loading…</p>;
  }
  if (pos.pending.length === 0) {
    return (
      <div className="px-4 pt-6 text-center">
        <QrCode className="mx-auto h-10 w-10 text-ink-500" aria-hidden="true" />
        <p className="mt-3 text-sm font-bold text-ink-800">No QR orders waiting</p>
        <p className="mt-1 text-sm font-semibold text-ink-600">
          Orders scanned at a table land here for approval before the kitchen sees them.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
      {pos.pending.map((order) => (
        <article key={order.id} className="rounded-card border-2 border-placed-ink/30 bg-placed/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-bold text-ink-900">
              {order.table.label}
              <span className="rounded-full bg-placed px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-placed-ink">
                QR order
              </span>
            </span>
            <span className="flex flex-none items-center gap-1 text-[11px] font-semibold text-ink-600">
              <Clock className="h-3 w-3" aria-hidden="true" /> {occupiedFor(order.placed_at)}
            </span>
          </div>

          <ul className="mt-2 divide-y divide-placed-ink/20 rounded-card bg-paper px-2.5">
            {order.items.map((line, i) => (
              <li key={`${order.id}-${i}`} className="flex items-baseline justify-between gap-2 py-1.5">
                <span className="text-sm font-bold text-ink-900">
                  {line.quantity}× {line.name}
                  {line.special_instructions && (
                    <span className="block text-xs font-semibold text-ink-600">{line.special_instructions}</span>
                  )}
                </span>
                <span className="flex-none font-mono text-sm font-bold text-ink-900">{formatMoney(line.line_total)}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-2 py-1.5">
              <span className="text-sm font-bold text-ink-900">Total</span>
              <span className="font-mono text-sm font-bold text-ink-900">{formatMoney(order.total_amount)}</span>
            </li>
          </ul>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pos.deciding === order.id}
              onClick={() => pos.rejectOrder(order.id)}
              className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-card border-2 border-danger-500 bg-paper text-sm font-bold text-danger-700 transition duration-150 ease-tap hover:bg-danger-50 active:scale-[0.98] disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" /> Reject
            </button>
            <button
              type="button"
              disabled={pos.deciding === order.id}
              onClick={() => pos.approveOrder(order.id)}
              className="flex min-h-12 flex-[2] items-center justify-center gap-1.5 rounded-card bg-brand text-sm font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden="true" /> Approve &amp; send to kitchen
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
