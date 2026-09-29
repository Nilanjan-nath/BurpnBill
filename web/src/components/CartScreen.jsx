import { useState } from 'react';
import { BottomBar } from './BottomBar.jsx';
import { PageHeader } from './PageHeader.jsx';
import { Stepper } from './Stepper.jsx';
import { card, input, link, muted, primary } from './ui.js';
import { formatMoney, plural } from '../format.js';

export function CartScreen({ menu, cart, busy, onBack, onQuantity, onNote, onRemoveUnavailable, onPlaceOrder }) {
  const currency = menu.restaurant.currency_code;
  const count = cart.items.reduce((n, line) => n + line.quantity, 0);
  const soldOut = cart.items.filter((line) => !line.available);

  return (
    <>
      <PageHeader title="Your order" subtitle={`Table ${menu.table.label}`} backLabel="Back to menu" onBack={onBack} />

      <main className="px-4 pb-32 pt-5">
        {cart.items.length === 0 ? (
          <div className="grid justify-items-center gap-4 py-16 text-center">
            <p className="font-semibold">Your order is empty.</p>
            <button type="button" className={primary} onClick={onBack}>Browse the menu</button>
          </div>
        ) : (
          <>
            {soldOut.length > 0 && (
              <div
                className="mb-3 grid gap-2 rounded-2xl bg-red-100 p-4 text-red-900 dark:bg-red-950 dark:text-red-100"
                role="alert"
              >
                <p>
                  <strong>No longer available:</strong> {soldOut.map((line) => line.name).join(', ')}
                </p>
                <button
                  type="button"
                  onClick={onRemoveUnavailable}
                  disabled={busy}
                  className="min-h-10 justify-self-start rounded-xl border-2 border-current px-4 font-bold active:scale-95 disabled:opacity-50"
                >
                  Remove from my order
                </button>
              </div>
            )}

            <ul className="grid gap-3">
              {cart.items.map((line) => (
                <CartLine key={line.id} line={line} currency={currency} busy={busy} onQuantity={onQuantity} onNote={onNote} />
              ))}
            </ul>

            <dl className="mt-5 px-1">
              <div className="flex justify-between text-lg font-extrabold">
                <dt>Subtotal · {plural(count, 'item')}</dt>
                <dd className="tabular-nums">{formatMoney(cart.subtotal, currency)}</dd>
              </div>
            </dl>
            <p className={`mt-2 px-1 text-sm ${muted}`}>You'll pay at the counter after your order.</p>
          </>
        )}
      </main>

      {cart.items.length > 0 && (
        <BottomBar
          label={busy ? 'Please wait…' : 'Place order'}
          total={formatMoney(cart.subtotal, currency)}
          onClick={onPlaceOrder}
          disabled={busy || soldOut.length > 0}
        />
      )}
    </>
  );
}

function CartLine({ line, currency, busy, onQuantity, onNote }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.special_instructions ?? '');

  const saveNote = async () => {
    if (await onNote(line, draft.trim())) setEditing(false);
  };

  return (
    <li className={`flex justify-between gap-3 p-4 ${card} ${line.available ? '' : 'border-dashed opacity-75 shadow-none'}`}>
      <div className="min-w-0 flex-1">
        <div className={`break-words font-bold ${line.available ? '' : 'line-through'}`}>{line.name}</div>
        {!line.available && (
          <div className="mt-1 inline-block rounded-md bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900 dark:bg-red-950 dark:text-red-100">
            Not available
          </div>
        )}

        {editing ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="basis-full">
              <span className="sr-only">Special instructions for {line.name}</span>
              <input
                type="text"
                value={draft}
                maxLength={280}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveNote()}
                placeholder="e.g. less sugar"
                className={input}
              />
            </label>
            <button
              type="button"
              onClick={saveNote}
              disabled={busy}
              className="min-h-10 rounded-xl bg-red-50 px-4 font-bold text-red-700 hover:bg-red-100 active:scale-95 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              className={link}
              onClick={() => { setDraft(line.special_instructions ?? ''); setEditing(false); }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className={`mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 break-words text-sm ${muted}`}>
            {line.special_instructions && <span>“{line.special_instructions}”</span>}
            <button
              type="button"
              className={link}
              onClick={() => setEditing(true)}
              aria-label={`${line.special_instructions ? 'Edit' : 'Add'} note for ${line.name}`}
            >
              {line.special_instructions ? 'Edit note' : 'Add note'}
            </button>
          </div>
        )}
      </div>

      <div className="grid content-start justify-items-end gap-2">
        <div className="font-extrabold tabular-nums">{formatMoney(line.line_total, currency)}</div>
        <Stepper value={line.quantity} min={0} name={line.name} disabled={busy} onChange={(q) => onQuantity(line, q)} />
      </div>
    </li>
  );
}
