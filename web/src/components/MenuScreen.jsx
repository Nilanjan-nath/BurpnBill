import { useState } from 'react';
import { ItemSheet } from './ItemSheet.jsx';
import { VegMark } from './VegMark.jsx';
import { formatMoney, plural } from '../format.js';

export function MenuScreen({ menu, cart, hasOrders, busy, onAdd, onOpenCart, onOpenBill }) {
  const [selected, setSelected] = useState(null);
  const currency = menu.restaurant.currency_code;
  const count = cart.items.reduce((n, line) => n + line.quantity, 0);

  return (
    <>
      <header className="top">
        <div>
          <h1>{menu.restaurant.name}</h1>
          <p className="muted">Table {menu.table.label}</p>
        </div>
        {hasOrders && (
          <button type="button" className="bill-link" onClick={onOpenBill}>Your bill</button>
        )}
      </header>

      <nav className="chips" aria-label="Menu categories">
        {menu.categories.map((c, i) => (
          <button key={c.name} type="button" onClick={() => document.getElementById(`cat-${i}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}>
            {c.name}
          </button>
        ))}
      </nav>

      <main className={count ? 'with-bar' : ''}>
        {menu.categories.length === 0 && <p className="muted empty">The menu is empty right now.</p>}
        {menu.categories.map((category, i) => (
          <section key={category.name} id={`cat-${i}`} aria-labelledby={`cat-title-${i}`}>
            <h2 id={`cat-title-${i}`}>{category.name}</h2>
            <ul className="items">
              {category.items.map((item) => (
                <li key={item.id} className="item">
                  <div className="item-info">
                    <div className="item-name"><VegMark isVeg={item.is_veg} /> {item.name}</div>
                    {item.description && <p className="muted">{item.description}</p>}
                    <div className="price">{formatMoney(item.price, currency)}</div>
                  </div>
                  <button type="button" className="add" onClick={() => setSelected(item)} aria-label={`Add ${item.name}`}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {count > 0 && (
        <button type="button" className="cart-bar" onClick={onOpenCart}>
          <span>View order · {plural(count, 'item')}</span>
          <strong>{formatMoney(cart.subtotal, currency)}</strong>
        </button>
      )}

      {selected && (
        <ItemSheet
          item={selected}
          currency={currency}
          busy={busy}
          onAdd={(quantity, note) => onAdd(selected.id, quantity, note)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
