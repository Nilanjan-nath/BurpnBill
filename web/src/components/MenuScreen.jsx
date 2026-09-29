import { useState } from 'react';
import { LayoutGrid, Plus, Receipt, Search, SlidersHorizontal, Utensils, X } from 'lucide-react';
import { BottomBar } from './BottomBar.jsx';
import { ItemSheet } from './ItemSheet.jsx';
import { VegMark } from './VegMark.jsx';
import { categoryIcon } from './categoryIcon.js';
import { card, muted, secondary } from './ui.js';
import { formatMoney, plural } from '../format.js';

// Veg / non-veg is the only filter this menu can honestly offer: it is the one
// property every item carries. An item whose owner never said either way
// (is_veg null) shows under "All" and under neither of the others, rather than
// being guessed into one.
const DIETS = [
  { id: 'all', label: 'Any' },
  { id: 'veg', label: 'Veg' },
  { id: 'nonveg', label: 'Non-veg' },
];
const matchesDiet = (item, diet) =>
  diet === 'all' || (diet === 'veg' ? item.is_veg === true : item.is_veg === false);

const chip =
  'flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold transition active:scale-95';
const chipOn = 'border-red-600 bg-red-600 text-white';
const chipOff =
  'border-stone-200 bg-white text-stone-800 hover:border-red-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100';

export function MenuScreen({ menu, cart, hasOrders, busy, onAdd, onOpenCart, onOpenBill }) {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [diet, setDiet] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [chosenCategory, setChosenCategory] = useState(null);

  const currency = menu.restaurant.currency_code;
  const count = cart.items.reduce((n, line) => n + line.quantity, 0);

  // The menu is refetched when the phone comes back to the tab, and the owner
  // may have renamed or removed the section in the meantime — fall back to All
  // rather than showing an empty page under a tab that no longer exists.
  const category = menu.categories.some((c) => c.name === chosenCategory) ? chosenCategory : null;

  const needle = query.trim().toLowerCase();
  const sections = menu.categories
    .filter((c) => category === null || c.name === category)
    .map((c) => ({
      ...c,
      items: c.items.filter(
        (item) =>
          matchesDiet(item, diet) &&
          (!needle || `${item.name} ${item.description ?? ''}`.toLowerCase().includes(needle)),
      ),
    }))
    .filter((c) => c.items.length > 0);
  const narrowed = needle !== '' || diet !== 'all' || category !== null;

  const clearFilters = () => {
    setQuery('');
    setDiet('all');
    setChosenCategory(null);
  };

  return (
    <>
      <header className="flex items-center gap-3 bg-white px-5 pb-3 pt-6 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold tracking-tight">{menu.restaurant.name}</h1>
          <p className="mt-1 inline-block rounded-full bg-red-50 px-3 py-0.5 text-sm font-bold text-red-700 dark:bg-red-950 dark:text-red-200">{`Table ${menu.table.label}`}</p>
        </div>
        {hasOrders && (
          <button
            type="button"
            onClick={onOpenBill}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border-2 border-red-600 px-4 text-sm font-bold text-red-700 hover:bg-red-50 active:scale-95 dark:border-red-500 dark:text-red-300 dark:hover:bg-stone-800"
          >
            <Receipt className="h-4 w-4" aria-hidden="true" />
            Your bill
          </button>
        )}
      </header>

      {/* Search and the category tabs stay put while the list scrolls: someone
          hungry and in a hurry should never have to scroll back up to look
          for something else. */}
      <div className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 pb-1 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
        <div className="flex items-center gap-2 px-4 pt-4">
          <label className="relative block flex-1">
            <span className="sr-only">Search the menu</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search from here"
              className="h-12 w-full rounded-full border border-stone-200 bg-white pl-5 pr-14 text-base text-stone-900 shadow-[0_2px_10px_rgba(28,25,23,0.07)] placeholder:text-stone-500 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:shadow-none dark:placeholder:text-stone-400"
            />
            <span className="pointer-events-none absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-red-600 text-white">
              <Search className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
          </label>
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            aria-label="Filter by veg or non-veg"
            aria-expanded={filterOpen}
            aria-controls="diet-filter"
            className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full border active:scale-95 ${
              filterOpen || diet !== 'all' ? chipOn : chipOff
            }`}
          >
            <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
            {diet !== 'all' && (
              <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-white ring-2 ring-red-600" />
            )}
          </button>
        </div>

        {filterOpen && (
          <div id="diet-filter" role="group" aria-label="Show" className="flex gap-2 px-4 pt-3">
            {DIETS.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={diet === d.id}
                onClick={() => setDiet(d.id)}
                className={`${chip} ${diet === d.id ? chipOn : chipOff}`}
              >
                {/* The button's own label says which; the mark is only colour. */}
                {d.id !== 'all' && <span aria-hidden="true"><VegMark isVeg={d.id === 'veg'} /></span>}
                {d.label}
              </button>
            ))}
          </div>
        )}

        <nav
          aria-label="Menu categories"
          className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <button
            type="button"
            aria-pressed={category === null}
            onClick={() => setChosenCategory(null)}
            className={`${chip} ${category === null ? chipOn : chipOff}`}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            All
          </button>
          {menu.categories.map((c) => {
            const Icon = categoryIcon(c.name);
            return (
              <button
                key={c.name}
                type="button"
                aria-pressed={category === c.name}
                onClick={() => setChosenCategory(c.name)}
                className={`${chip} ${category === c.name ? chipOn : chipOff}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {c.name}
              </button>
            );
          })}
        </nav>
      </div>

      <main className={`px-4 pt-2 ${count ? 'pb-32' : 'pb-10'}`}>
        {menu.categories.length === 0 && (
          <p className={`py-16 text-center ${muted}`}>The menu is empty right now.</p>
        )}
        {menu.categories.length > 0 && sections.length === 0 && narrowed && (
          <div className="grid justify-items-center gap-4 py-16 text-center">
            <p className="font-semibold">Nothing matches that.</p>
            <button type="button" className={secondary} onClick={clearFilters}>
              <X className="h-4 w-4" aria-hidden="true" />
              Clear search and filters
            </button>
          </div>
        )}
        {sections.map((section) => {
          const Icon = categoryIcon(section.name);
          const headingId = `cat-title-${menu.categories.findIndex((c) => c.name === section.name)}`;
          return (
            <section key={section.name} aria-labelledby={headingId} className="pt-5">
              <h2 id={headingId} className="mb-3 flex items-center gap-2 text-xl font-extrabold">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {section.name}
              </h2>
              <ul className="grid gap-3">
                {section.items.map((item) => (
                  <li key={item.id} className={`flex min-w-0 items-center gap-3 p-3 ${card}`}>
                    {/* Decorative either way: the name right beside it already
                        says what the dish is. A dish with no photo gets a quiet
                        placeholder in the same square, so a half-photographed
                        menu still reads as one list rather than a ragged one. */}
                    {item.image_url ? (
                      <img
                        className="h-24 w-24 shrink-0 self-start rounded-2xl bg-stone-200 object-cover dark:bg-stone-800"
                        src={item.image_url}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="grid h-24 w-24 shrink-0 place-items-center self-start rounded-2xl bg-red-50 text-red-300 dark:bg-stone-800 dark:text-stone-500"
                      >
                        <Utensils className="h-7 w-7" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2 font-bold leading-snug">
                        <span className="mt-1"><VegMark isVeg={item.is_veg} /></span>
                        <span className="line-clamp-2">{item.name}</span>
                      </div>
                      {item.description && (
                        <p className={`mt-0.5 truncate text-sm ${muted}`}>{item.description}</p>
                      )}
                      <p className="mt-1 font-extrabold tabular-nums">{formatMoney(item.price, currency)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelected(item)}
                      aria-label={`Add ${item.name}`}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-red-600 bg-white text-red-600 transition hover:bg-red-50 active:scale-90 dark:border-red-500 dark:bg-transparent dark:text-red-400 dark:hover:bg-stone-800"
                    >
                      <Plus className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>

      {count > 0 && (
        <BottomBar label={`View order · ${plural(count, 'item')}`} total={formatMoney(cart.subtotal, currency)} onClick={onOpenCart} />
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
