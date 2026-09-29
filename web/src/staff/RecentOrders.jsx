import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, RefreshCw, Search, XCircle } from 'lucide-react';
import { formatMoney, formatTime } from '../format.js';
import { useRecentOrders } from './useRecentOrders.js';

// Orders that are done with — served or cancelled — for "what did table 4
// actually order", "did we already serve #1014", "why doesn't the till match"
// (something got cancelled, or went out unpaid). Each row opens the same
// detail drawer the live board uses.
//
// Read a day at a time rather than on a rolling window, because the questions
// asked here are the day's: the boundary is the CAFÉ's midnight, computed
// server-side from the browser's zone (see useRecentOrders).

const DAYS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
];

// The status filters are the two real outcomes plus the mixed view. All comes
// first and is the default: a cancelled order sitting between two served ones
// is exactly what "why doesn't the till match" looks for, so splitting them by
// default would hide the thing being looked for.
const FILTERS = [
  { id: 'all', label: 'All', Icon: ClipboardList, on: 'bg-teal-600 text-white' },
  { id: 'served', label: 'Served', Icon: CheckCircle2, on: 'bg-emerald-600 text-white' },
  { id: 'cancelled', label: 'Cancelled', Icon: XCircle, on: 'bg-red-600 text-white' },
];

const STATUS_PILL = {
  served: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

const PAYMENT_LABEL = { cash: 'Cash', card: 'Card', upi: 'UPI', mock: 'Test' };

// Six columns plus the items, which takes the slack. The row stays one line —
// the whole point of a table here is that thirty of them can be scanned — so
// anything that doesn't fit is truncated and the drawer has the rest.
//
// The columns are sized to fit a 1024px laptop once the sidebar has taken its
// 256px: at the first draft's widths the AMOUNT column fell off the right edge
// there, which is the one column nobody scrolls to find — they assume it isn't
// shown. Narrower than that and the whole row scrolls sideways, which is the
// same width at which the sidebar itself stops fitting (a known gap).
const GRID = 'grid grid-cols-[5.5rem_4rem_minmax(6rem,1fr)_5rem_5.5rem_5.5rem_6rem] items-center gap-3';

// What a cell says when there is genuinely nothing to say. A cancelled order
// was never paid for, so it gets an em dash rather than "Unpaid", which would
// read as money someone still owes.
function PaymentCell({ status, method }) {
  if (status === 'cancelled') return <span className="text-sm font-semibold text-gray-600">—</span>;
  if (!method) return <span className="w-fit rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">Unpaid</span>;
  return <span className="text-sm font-semibold text-gray-700">{PAYMENT_LABEL[method] ?? method}</span>;
}

export function RecentOrders({ token, onOpenDetail }) {
  const [day, setDay] = useState('today');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const recent = useRecentOrders(token, day);

  const orders = recent.orders ?? [];
  const counts = useMemo(
    () => ({
      all: orders.length,
      served: orders.filter((o) => o.status === 'served').length,
      cancelled: orders.filter((o) => o.status === 'cancelled').length,
    }),
    [orders],
  );

  // Order number, table, who finished it and what was on it — the four things
  // someone at the counter already knows when they come looking for a row.
  const visible = useMemo(() => {
    const byStatus = filter === 'all' ? orders : orders.filter((o) => o.status === filter);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((o) =>
      [`#${o.order_number}`, o.table.label, o.finished_by ?? '', ...o.items.map((i) => i.name)]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [orders, filter, search]);

  if (recent.error) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div
          className="mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800"
          role="alert"
        >
          <span>{recent.error}</span>
          <button type="button" onClick={recent.refresh} className="font-bold">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">Finished orders</h2>
            <p className="text-sm font-semibold text-gray-600">
              {recent.orders === null
                ? 'Loading…'
                : `${counts.all} ${counts.all === 1 ? 'order' : 'orders'} · ${counts.served} served · ${counts.cancelled} cancelled`}
            </p>
          </div>
          <button
            type="button"
            onClick={recent.refresh}
            className="flex items-center gap-1.5 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Day">
            {DAYS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={day === id}
                onClick={() => setDay(id)}
                className={`rounded-lg px-4 py-2 text-sm font-bold ${
                  day === id ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-700 hover:bg-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ id, label, Icon, on }) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold ${
                  filter === id ? on : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {label} ({counts[id]})
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order, table or dish…"
                aria-label="Search recent orders"
                className="w-full min-w-72 rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-500 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
              />
            </div>
            <span className="rounded-full border border-gray-300 px-3 py-1 text-xs font-bold text-gray-700">
              {visible.length} shown
            </span>
          </div>

          {recent.orders === null ? (
            <p className="p-10 text-center text-sm font-semibold text-gray-700">Loading…</p>
          ) : visible.length === 0 ? (
            <div className="p-12 text-center">
              <ClipboardList className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
              <p className="mt-3 text-sm font-bold text-gray-900">
                {orders.length === 0
                  ? `Nothing served or cancelled ${day === 'today' ? 'today' : 'yesterday'} yet`
                  : 'No orders match that'}
              </p>
              <p className="mt-1 text-sm font-semibold text-gray-600">
                {orders.length === 0
                  ? 'Orders land here once the kitchen is done with them.'
                  : 'Try a different search, or another status.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[42rem]">
                {/* Column labels are a scanning aid for the eye; each row's own
                    button reads out its values in this order, so a screen
                    reader gets the whole row from the control it lands on. */}
                <div
                  className={`${GRID} border-b border-gray-200 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-600`}
                  aria-hidden="true"
                >
                  <span>Order</span>
                  <span>Table</span>
                  <span>Items</span>
                  <span>Time</span>
                  <span>Staff</span>
                  <span>Payment</span>
                  <span className="text-right">Amount</span>
                </div>

                <ul>
                  {visible.map((order) => (
                    <li key={order.id} className="border-b border-gray-200 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => onOpenDetail(order.id)}
                        className={`${GRID} w-full px-4 py-3 text-left hover:bg-gray-50 focus-visible:bg-gray-50`}
                      >
                        <span className="flex flex-col items-start gap-1">
                          <span className="text-sm font-bold text-gray-900">#{order.order_number}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_PILL[order.status]}`}>
                            {order.status}
                          </span>
                        </span>
                        <span className="text-sm font-bold text-gray-900">{order.table.label}</span>
                        <span className="truncate text-sm font-semibold text-gray-700">
                          {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-gray-700">
                          {formatTime(order.finished_at)}
                        </span>
                        <span className="truncate text-sm font-semibold text-gray-700">{order.finished_by ?? '—'}</span>
                        <PaymentCell status={order.status} method={order.payment_method} />
                        <span className="text-right text-sm font-bold tabular-nums text-gray-900">
                          {formatMoney(order.total_amount)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
