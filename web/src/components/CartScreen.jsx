import { useState } from 'react';
import { Stepper } from './Stepper.jsx';
import { formatMoney, plural } from '../format.js';

export function CartScreen({ menu, cart, busy, onBack, onQuantity, onNote, onRemoveUnavailable, onPlaceOrder }) {
  const currency = menu.restaurant.currency_code;
  const count = cart.items.reduce((n, line) => n + line.quantity, 0);
  const soldOut = cart.items.filter((line) => !line.available);

  return (
    <>
      <header className="top with-back">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to menu">←</button>
        <div>
          <h1>Your order</h1>
          <p className="muted">Table {menu.table.label}</p>
        </div>
      </header>

      <main className="cart with-bar">
        {cart.items.length === 0 ? (
          <div className="empty">
            <p>Your order is empty.</p>
            <button type="button" className="primary" onClick={onBack}>Browse the menu</button>
          </div>
        ) : (
          <>
            {soldOut.length > 0 && (
              <div className="sold-out" role="alert">
                <p>
                  <strong>No longer available:</strong> {soldOut.map((line) => line.name).join(', ')}
                </p>
                <button type="button" onClick={onRemoveUnavailable} disabled={busy}>Remove from my order</button>
              </div>
            )}

            <ul className="lines">
              {cart.items.map((line) => (
                <CartLine key={line.id} line={line} currency={currency} busy={busy} onQuantity={onQuantity} onNote={onNote} />
              ))}
            </ul>

            <dl className="totals">
              <div>
                <dt>Subtotal · {plural(count, 'item')}</dt>
                <dd>{formatMoney(cart.subtotal, currency)}</dd>
              </div>
            </dl>
            <p className="muted small">You'll pay at the counter after your order.</p>
          </>
        )}
      </main>

      {cart.items.length > 0 && (
        <div className="cart-bar-wrap">
          <button
            type="button"
            className="cart-bar"
            onClick={onPlaceOrder}
            disabled={busy || soldOut.length > 0}
          >
            <span>{busy ? 'Please wait…' : 'Place order'}</span>
            <strong>{formatMoney(cart.subtotal, currency)}</strong>
          </button>
        </div>
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
    <li className={`line ${line.available ? '' : 'unavailable'}`}>
      <div className="line-main">
        <div className="line-name">{line.name}</div>
        {!line.available && <div className="badge">Not available</div>}

        {editing ? (
          <div className="note-edit">
            <label>
              <span className="sr-only">Special instructions for {line.name}</span>
              <input
                type="text"
                value={draft}
                maxLength={280}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveNote()}
                placeholder="e.g. less sugar"
              />
            </label>
            <button type="button" onClick={saveNote} disabled={busy}>Save</button>
            <button type="button" className="link" onClick={() => { setDraft(line.special_instructions ?? ''); setEditing(false); }}>Cancel</button>
          </div>
        ) : (
          <div className="note">
            {line.special_instructions && <span>“{line.special_instructions}”</span>}
            <button type="button" className="link" onClick={() => setEditing(true)} aria-label={`${line.special_instructions ? 'Edit' : 'Add'} note for ${line.name}`}>
              {line.special_instructions ? 'Edit note' : 'Add note'}
            </button>
          </div>
        )}
      </div>

      <div className="line-side">
        <div className="price">{formatMoney(line.line_total, currency)}</div>
        <Stepper value={line.quantity} min={0} name={line.name} disabled={busy} onChange={(q) => onQuantity(line, q)} />
      </div>
    </li>
  );
}
