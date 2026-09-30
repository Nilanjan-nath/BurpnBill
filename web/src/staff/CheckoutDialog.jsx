import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Banknote, CreditCard, QrCode, X, Maximize2, Minimize2, Printer, CheckCircle2 } from 'lucide-react';
import { formatMoney } from '../format.js';

// Cash/card/UPI mirror the payments table's own method enum (minus 'mock',
// which exists for tests). Nothing here moves money: the counter takes it the
// way it always has, and this records which way that was — see
// server/src/services/tables.js and ARCHITECTURE.md §2. No Wallet: there's no
// such method in the schema, and a button that can't be recorded is a lie.
const METHODS = [
  { id: 'cash', label: 'Cash', Icon: Banknote },
  { id: 'card', label: 'Card', Icon: CreditCard },
  { id: 'upi', label: 'UPI', Icon: QrCode },
];

// m-auto is load-bearing: Tailwind's preflight sets `margin: 0` on every
// element, which overrides the `margin: auto` a native modal <dialog> relies on
// to centre itself — without it the panel sticks to the top-left corner.
// bg/text are explicit for the reason in docs/design.md (a <dialog> with no
// background falls back to the UA's dark `canvas` colour in dark mode).
const PANEL = 'm-auto rounded-card bg-paper p-0 text-ink-900 shadow-pop backdrop:bg-ink-900/50';
const COMPACT = `w-[min(34rem,92vw)] ${PANEL}`;
const FULLSCREEN = `h-[100dvh] max-h-none w-[100vw] max-w-none rounded-none ${PANEL}`;

export function CheckoutDialog({ bill, busy, onConfirm, onClose }) {
  const dialogRef = useRef(null);
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [fullScreen, setFullScreen] = useState(false);
  const [receipt, setReceipt] = useState(null);

  // One key per opened bill, so a double-tapped Confirm is a retry of the same
  // payment rather than a second one. Regenerating it per tap would defeat the
  // server's idempotency entirely.
  const idempotencyKey = useMemo(() => `${bill.table.id}-${bill.generated_at}-${crypto.randomUUID()}`, [bill]);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const total = Number(bill.totals.total);
  const tax = Number(bill.totals.tax);
  const change = method === 'cash' && tendered !== '' ? Number(tendered) - total : null;
  const orderCount = bill.orders.length;
  const itemCount = bill.orders.reduce((n, o) => n + o.items.length, 0);

  const confirm = async () => {
    const result = await onConfirm({ method, idempotencyKey });
    if (result) setReceipt(result);
  };

  if (receipt) {
    return (
      <>
        <dialog ref={dialogRef} onClose={onClose} aria-label="Payment complete" className={fullScreen ? FULLSCREEN : COMPACT}>
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <CheckCircle2 className="h-14 w-14 text-ready-ink" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-extrabold text-ink-900">Payment received</h2>
            <p className="mt-1 font-mono text-3xl font-bold text-ready-ink">{formatMoney(receipt.amount)}</p>
            <p className="mt-1 font-mono text-xs font-bold uppercase tracking-wide text-ink-600">
              {receipt.method} · {bill.table.label} · {new Date(receipt.paid_at).toLocaleString()}
            </p>
            <div className="mt-6 flex w-full gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-card border-2 border-ink-300 text-sm font-bold text-ink-800 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.98]"
              >
                <Printer className="h-4 w-4" aria-hidden="true" /> Print receipt
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 flex-1 rounded-card bg-brand text-sm font-bold uppercase tracking-wide text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </dialog>
        <PrintableReceipt bill={bill} receipt={receipt} />
      </>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label={`Checkout for ${bill.table.label}`}
      className={fullScreen ? FULLSCREEN : COMPACT}
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-none items-start justify-between gap-3 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-extrabold text-ink-900">Checkout</h2>
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-600">
              {bill.table.label}
              {orderCount > 1 && (
                <span className="rounded-full bg-butter-300 px-2 py-0.5 text-xs font-bold text-ink-900">
                  {orderCount} orders merged
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-none items-center gap-1">
            <button
              type="button"
              onClick={() => setFullScreen((v) => !v)}
              aria-pressed={fullScreen}
              className="flex min-h-11 items-center gap-1.5 rounded-input border-2 border-ink-300 px-3 text-xs font-bold text-ink-700 transition duration-150 ease-tap hover:bg-ink-50"
            >
              {fullScreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
              {fullScreen ? 'Exit full screen' : 'Full screen'}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="flex min-h-11 min-w-11 items-center justify-center rounded-input text-ink-600 hover:bg-ink-100">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 ${fullScreen ? 'grid grid-cols-2 gap-6' : ''}`}>
          <section>
            <h3 className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">
              All items{orderCount > 1 ? ` (${orderCount} orders)` : ''}
            </h3>
            {itemCount === 0 ? (
              <p className="mt-2 text-sm font-semibold text-ink-700">Nothing outstanding on this table.</p>
            ) : (
              <div className="mt-2 rounded-card bg-ink-50 px-3 py-1">
                {bill.orders.map((order, roundIndex) => (
                  <div key={order.id} className="py-1.5">
                    {/* Rounds, not just a flat list: a table that ordered twice
                        should be able to see which round a line came from. */}
                    {orderCount > 1 && (
                      <p className="pt-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-ink-500">
                        Round {roundIndex + 1} · #{order.order_number}
                      </p>
                    )}
                    <ul className="divide-y divide-ink-200">
                      {order.items.map((line, i) => (
                        <li key={`${order.id}-${i}`} className="flex items-baseline justify-between gap-3 py-2">
                          <span className="text-sm font-bold text-ink-900">
                            {line.quantity}× {line.name}
                            {line.special_instructions && (
                              <span className="block text-xs font-semibold text-ink-600">{line.special_instructions}</span>
                            )}
                          </span>
                          <span className="flex-none font-mono text-sm font-bold text-ink-900">{formatMoney(line.line_total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <dl className="mt-4 space-y-1.5 border-t border-ink-200 pt-3">
              <div className="flex justify-between text-sm font-semibold text-ink-700">
                <dt>Subtotal</dt>
                <dd className="font-mono">{formatMoney(bill.totals.subtotal)}</dd>
              </div>
              {/* No tax engine yet (orders.tax_amount is always 0) — showing a
                  permanent ₹0.00 row would imply one exists. */}
              {tax > 0 && (
                <div className="flex justify-between text-sm font-semibold text-ink-700">
                  <dt>Tax</dt>
                  <dd className="font-mono">{formatMoney(bill.totals.tax)}</dd>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-ink-900">
                <dt>Total</dt>
                <dd className="font-mono">{formatMoney(bill.totals.total)}</dd>
              </div>
            </dl>
          </section>

          <section className={fullScreen ? '' : 'mt-5'}>
            <h3 className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">Payment method</h3>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {METHODS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={method === id}
                  onClick={() => setMethod(id)}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-card border-2 py-3 text-sm font-bold transition-colors duration-150 ease-tap ${
                    method === id ? 'border-brand bg-brand-50 text-brand-700' : 'border-ink-300 text-ink-700 hover:bg-ink-50'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            {method === 'cash' && (
              <div className="mt-4">
                <label htmlFor="tendered" className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">
                  Amount tendered
                </label>
                <input
                  id="tendered"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  placeholder={`Exact amount (${formatMoney(total)})`}
                  className="mt-1 min-h-12 w-full rounded-input border border-ink-300 px-3 font-mono text-base font-semibold text-ink-900 outline-none placeholder:font-sans placeholder:text-sm placeholder:font-medium placeholder:text-ink-500 focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                {change !== null && change >= 0 && (
                  <p className="mt-2 text-sm font-bold text-ink-900">
                    Change due <span className="font-mono text-brand-700">{formatMoney(change.toFixed(2))}</span>
                  </p>
                )}
                {change !== null && change < 0 && (
                  <p className="mt-2 text-sm font-bold text-danger-700">
                    {formatMoney(Math.abs(change).toFixed(2))} short of the total.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="flex-none border-t border-ink-200 px-5 py-4">
          <div className="mb-3 flex items-center justify-between rounded-card bg-ink-100 px-4 py-3">
            <span className="text-sm font-bold text-ink-700">Total to pay</span>
            <span className="font-mono text-xl font-bold text-ink-900">{formatMoney(bill.totals.total)}</span>
          </div>
          <button
            type="button"
            disabled={busy || itemCount === 0}
            onClick={confirm}
            className="min-h-12 w-full rounded-card bg-brand py-3 text-sm font-bold uppercase tracking-wide text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Settling…' : `Confirm payment · ${formatMoney(bill.totals.total)}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// Printed through a portal to <body> rather than from inside the <dialog>:
// a modal dialog lives in the browser's top layer, which browsers print
// inconsistently. Hidden on screen, shown only by the @media print rules in
// tailwind.css (which hide #root at the same time).
function PrintableReceipt({ bill, receipt }) {
  return createPortal(
    <div className="bnb-print-receipt">
      <h1>{bill.table.label} — receipt</h1>
      <p>{new Date(receipt.paid_at).toLocaleString()}</p>
      {bill.orders.map((order, roundIndex) => (
        <div key={order.id}>
          <p>
            <strong>
              Round {roundIndex + 1} · #{order.order_number}
            </strong>
          </p>
          <ul>
            {order.items.map((line, i) => (
              <li key={`${order.id}-${i}`}>
                {line.quantity}× {line.name} — {formatMoney(line.line_total)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p>
        <strong>Total {formatMoney(receipt.amount)}</strong> — paid by {receipt.method}
      </p>
    </div>,
    document.body,
  );
}
