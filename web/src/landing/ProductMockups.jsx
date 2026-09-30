import { Bell, Clock, LayoutGrid, Search, Utensils } from 'lucide-react';

// The product, drawn as the product. These are built from the same design
// system the real dashboard uses — the BurpnBill brand tokens, the same
// amber/blue/green status pairs, the same card shapes — so what a visitor sees
// here is what they get, not a stylised impression of it. The one exception is
// PhoneMock, which draws the CUSTOMER app: that is a separate surface with its
// own red-on-white look, and drawing it in crimson would be the mockup lying.
//
// They are mockups and not screenshots, deliberately: a screenshot of a real
// café's board would carry a real café's orders. Nothing here claims to be a
// photograph of a running service. When real screenshots exist they can replace
// these one for one — the frames are the same shape.
//
// Everything is decorative in the accessibility sense: each mockup is wrapped
// by the caller in a container with its own description, and the numbers inside
// are illustrative, so screen readers get the sentence rather than a soup of
// table numbers.

function Frame({ label, children }) {
  return (
    <div className="overflow-hidden rounded-card border border-ink-200 bg-paper shadow-pop">
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
        <span className="ml-2 text-xs font-semibold text-ink-500">{label}</span>
      </div>
      {children}
    </div>
  );
}

const COLUMNS = [
  {
    name: 'New',
    accent: 'bg-placed-ink',
    pill: 'bg-placed text-placed-ink',
    cards: [
      { table: 'Table 4', number: '#1042', items: '2× Masala Chai · 1× Samosa', age: '2m' },
      { table: 'Table 9', number: '#1043', items: '1× Cold Coffee', age: '1m' },
    ],
  },
  {
    name: 'Preparing',
    accent: 'bg-prep-ink',
    pill: 'bg-prep text-prep-ink',
    cards: [{ table: 'Table 2', number: '#1041', items: '1× Veg Fried Rice · 2× Lime Soda', age: '6m' }],
  },
  {
    name: 'Ready',
    accent: 'bg-ready-ink',
    pill: 'bg-ready text-ready-ink',
    cards: [{ table: 'Table 7', number: '#1039', items: '1× Paneer Tikka Roll', age: '9m' }],
  },
];

export function KitchenBoardMock() {
  return (
    <Frame label="Order board">
      <div className="grid grid-cols-3 gap-3 bg-ink-50 p-3 sm:gap-4 sm:p-4">
        {COLUMNS.map(({ name, accent, pill, cards }) => (
          <div key={name} className="overflow-hidden rounded-card border border-ink-200 bg-paper">
            <div className={`h-1 ${accent}`} />
            <div className="flex items-center justify-between px-2.5 py-2 sm:px-3">
              <span className="text-[11px] font-bold text-ink-900 sm:text-xs">{name}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${pill}`}>{cards.length}</span>
            </div>
            <div className="space-y-2 px-2 pb-2 sm:px-2.5 sm:pb-2.5">
              {cards.map(({ table, number, items, age }) => (
                <div key={number} className="rounded-lg border border-ink-200 p-2">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[11px] font-bold text-ink-900 sm:text-xs">{table}</span>
                    <span className="text-[10px] font-semibold tabular-nums text-ink-500">{age}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] font-semibold text-ink-600">{items}</p>
                  <p className="mt-1 text-[10px] font-semibold text-ink-500">{number}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

const TABLES = [
  { label: 'T1', state: 'free' },
  { label: 'T2', state: 'busy', total: '₹430', age: '22m' },
  { label: 'T3', state: 'free' },
  { label: 'T4', state: 'busy', total: '₹190', age: '8m' },
  { label: 'T5', state: 'free' },
  { label: 'T6', state: 'free' },
];

export function FloorPlanMock() {
  return (
    <Frame label="POS · Floor">
      <div className="bg-ink-50 p-4">
        <div className="mb-3 flex gap-2">
          <span className="rounded-full bg-ready px-2.5 py-1 text-xs font-bold text-ready-ink">4 free</span>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">2 occupied</span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {TABLES.map(({ label, state, total, age }) => (
            <div
              key={label}
              className={`rounded-xl border p-2.5 ${
                state === 'busy' ? 'border-brand-200 bg-brand-50' : 'border-ready-ink/25 bg-ready'
              }`}
            >
              <p className="text-xs font-bold text-ink-900">{label}</p>
              {state === 'busy' ? (
                <>
                  <p className="mt-1 text-sm font-bold tabular-nums text-ink-900">{total}</p>
                  <p className="text-[10px] font-semibold text-ink-600">{age} seated</p>
                </>
              ) : (
                <p className="mt-1 text-[10px] font-semibold text-ready-ink">Available</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

const DISHES = [
  { name: 'Masala Chai', price: '₹30', on: true },
  { name: 'Paneer Tikka Roll', price: '₹140', on: true },
  { name: 'Cold Coffee', price: '₹90', on: false },
  { name: 'Veg Fried Rice', price: '₹150', on: true },
];

export function MenuMock() {
  return (
    <Frame label="Menu">
      <div className="bg-ink-50 p-4">
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2">
          <Search className="h-3.5 w-3.5 text-ink-500" aria-hidden="true" />
          <span className="text-xs font-semibold text-ink-500">Search dishes…</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {DISHES.map(({ name, price, on }) => (
            <div key={name} className={`rounded-xl border border-ink-200 bg-white p-2.5 ${on ? '' : 'opacity-70'}`}>
              <div className="mb-2 flex h-10 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">
                {name.slice(0, 2).toUpperCase()}
              </div>
              <p className="truncate text-[11px] font-bold text-ink-900">{name}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[11px] font-bold text-ink-900">{price}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    on ? 'bg-ready text-ready-ink' : 'bg-danger-500 text-white'
                  }`}
                >
                  {on ? 'On' : '86’d'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

// The customer's half, which is the half the café owner never sees and most
// wants to be reassured about. Drawn in the customer app's own red (#dc2626,
// red-600 there) rather than the brand crimson, because that is what the
// customer's phone actually shows.
export function PhoneMock() {
  return (
    <div className="mx-auto w-[200px] rounded-[2rem] border-[6px] border-ink-900 bg-white shadow-2xl shadow-ink-900/20">
      <div className="rounded-[1.6rem] bg-ink-50 p-3">
        <p className="text-sm font-bold text-ink-900">Chai Point Cafe</p>
        <p className="text-[10px] font-semibold text-ink-500">Table 4</p>
        <div className="mt-2 flex gap-1">
          <span className="rounded-full bg-[#dc2626] px-2 py-0.5 text-[9px] font-bold text-white">Beverages</span>
          <span className="rounded-full border border-ink-300 px-2 py-0.5 text-[9px] font-bold text-ink-600">
            Snacks
          </span>
        </div>
        <div className="mt-2 space-y-1.5">
          {[
            ['Masala Chai', '₹30'],
            ['Filter Coffee', '₹40'],
            ['Cold Coffee', '₹90'],
          ].map(([name, price]) => (
            <div key={name} className="flex items-center justify-between rounded-lg border border-ink-200 bg-white p-2">
              <div>
                <p className="text-[10px] font-bold text-ink-900">{name}</p>
                <p className="text-[10px] font-bold text-ink-700">{price}</p>
              </div>
              <span className="rounded-lg bg-[#dc2626] px-2 py-1 text-[9px] font-bold text-white">Add</span>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-lg bg-[#dc2626] py-1.5 text-center text-[10px] font-bold text-white">
          Place order · ₹160
        </div>
      </div>
    </div>
  );
}

// POS order entry: the counter ringing up a walk-in, which never touches a QR
// code at all. Same two-pane shape as the real screen — the menu to pick from,
// the running order beside it.
const POS_ITEMS = [
  ['Masala Chai', '₹30'],
  ['Samosa (2)', '₹40'],
  ['Veg Sandwich', '₹80'],
  ['Filter Coffee', '₹40'],
  ['Maggi Masala', '₹60'],
  ['Cold Coffee', '₹90'],
];

export function PosOrderMock() {
  return (
    <Frame label="POS · Table 5">
      <div className="grid grid-cols-5 gap-3 bg-ink-50 p-3 sm:p-4">
        <div className="col-span-3">
          <div className="mb-2 flex gap-1.5">
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">All</span>
            <span className="rounded-full border border-ink-300 bg-white px-2 py-0.5 text-[10px] font-bold text-ink-600">
              Snacks
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {POS_ITEMS.map(([name, price]) => (
              <div key={name} className="rounded-lg border border-ink-200 bg-white p-2">
                <p className="truncate text-[10px] font-bold text-ink-900">{name}</p>
                <p className="mt-0.5 text-[10px] font-bold text-ink-700">{price}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="col-span-2 overflow-hidden rounded-xl border border-ink-200 bg-white">
          <p className="bg-brand-600 px-2.5 py-1.5 text-[10px] font-bold text-white">Order · Table 5</p>
          <div className="space-y-1.5 p-2.5">
            {[
              ['2× Masala Chai', '₹60'],
              ['1× Veg Sandwich', '₹80'],
            ].map(([line, amount]) => (
              <div key={line} className="flex justify-between text-[10px] font-semibold text-ink-700">
                <span className="truncate">{line}</span>
                <span className="tabular-nums">{amount}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between rounded-lg bg-ink-100 px-2 py-1.5 text-[11px] font-bold text-ink-900">
              <span>Total</span>
              <span className="tabular-nums">₹140</span>
            </div>
            <div className="rounded-lg bg-brand-600 py-1.5 text-center text-[10px] font-bold text-white">
              Send to kitchen
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// The seating plan: the room on a grid, which the owner arranges and POS then
// draws from. The dots are the affordance in the real screen too.
const PLACED = [
  { label: 'T1', x: 0, y: 0, seats: 2 },
  { label: 'T2', x: 1, y: 0, seats: 4 },
  { label: 'T3', x: 3, y: 0, seats: 4 },
  { label: 'T4', x: 0, y: 1, seats: 6 },
  { label: 'T5', x: 2, y: 1, seats: 4 },
  { label: 'T6', x: 4, y: 2, seats: 2 },
];

export function SeatingPlanMock() {
  return (
    <Frame label="Settings · Seating plan">
      <div className="bg-ink-50 p-4">
        <div
          className="relative rounded-xl border border-ink-200 bg-white p-2"
          style={{ backgroundImage: 'radial-gradient(#c9bec3 1px, transparent 1px)', backgroundSize: '20% 25%' }}
        >
          <div className="grid grid-cols-5 grid-rows-3 gap-1.5" style={{ minHeight: '150px' }}>
            {PLACED.map(({ label, x, y, seats }) => (
              <div
                key={label}
                style={{ gridColumnStart: x + 1, gridRowStart: y + 1 }}
                className={`flex flex-col items-center justify-center rounded-lg border text-center ${
                  label === 'T5' ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-ink-300 bg-white'
                }`}
              >
                <span className="text-[10px] font-bold text-ink-900">{label}</span>
                <span className="text-[9px] font-semibold text-ink-500">{seats} seats</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] font-semibold text-brand-700">Drop in row 2, column 3</p>
      </div>
    </Frame>
  );
}

// Today's numbers. Takings and money still owed are deliberately two figures on
// the real screen, and they are two here.
const HOURS = [14, 22, 38, 61, 45, 30, 52, 78, 64, 40];

export function DashboardMock() {
  return (
    <Frame label="Dashboard">
      <div className="bg-ink-50 p-4">
        <div className="grid grid-cols-2 gap-2.5">
          {[
            ['Taken today', '₹4,280', 'text-ink-900'],
            ['Open on tables', '₹620', 'text-placed-ink'],
            ['Orders today', '38', 'text-ink-900'],
            ['Avg prep time', '6.4m', 'text-ink-900'],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border border-ink-200 bg-white p-2.5">
              <p className="text-[10px] font-semibold text-ink-500">{label}</p>
              <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-2.5 rounded-xl border border-ink-200 bg-white p-3">
          <p className="text-[10px] font-semibold text-ink-500">Sales by hour</p>
          <div className="mt-2 flex h-16 items-end gap-1">
            {HOURS.map((h, i) => (
              <div key={i} className="flex-1 rounded-sm bg-brand-500/80" style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[9px] font-semibold text-ink-500">
            <span>10am</span>
            <span>2pm</span>
            <span>7pm</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export const MOCK_ICONS = { Bell, Clock, LayoutGrid, Utensils };
