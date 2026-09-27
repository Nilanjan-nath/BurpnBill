import { ShoppingCart, ClipboardList, Timer, Ban, EyeOff, Users, TrendingUp } from 'lucide-react';
import { useDashboard } from './useDashboard.js';
import { BarChart, SplitBar, Delta } from './DashboardCharts.jsx';
import { formatMoney } from '../format.js';

// Today at a glance, for the owner. Deliberately plain: white tiles with dark
// numbers, and colour only where it means something — money still owed, a
// queue waiting on someone, a cancellation. A wall of pastel tiles (as in the
// reference) reads as decoration, and this screen exists to be scanned in
// five seconds. See docs/design.md's "what color is not for".
function Tile({ label, value, sub, tone = 'plain', Icon, footer }) {
  const TONE = {
    plain: 'text-gray-900',
    accent: 'text-teal-700',
    warn: 'text-amber-700',
    bad: 'text-red-700',
    good: 'text-emerald-700',
  };
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600">{label}</p>
        {Icon && <Icon className="h-4 w-4 flex-none text-gray-400" aria-hidden="true" />}
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${TONE[tone]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs font-semibold text-gray-600">{sub}</p>}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

// A count that is also a way in — tapping it goes where the work is.
function QueueTile({ label, count, tone, onClick }) {
  const TONE = {
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    accent: 'border-teal-300 bg-teal-50 text-teal-800',
    good: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    plain: 'border-gray-200 bg-white text-gray-900',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-shadow hover:shadow-md ${count > 0 ? TONE[tone] : TONE.plain}`}
    >
      <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{count}</p>
    </button>
  );
}

export function DashboardHome({ token, onNavigate }) {
  const { summary, error } = useDashboard(token);

  if (error) {
    return (
      <div className="p-6">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!summary) return <p className="p-10 text-center text-sm font-semibold text-gray-700">Loading today…</p>;

  const {
    money,
    kitchen,
    tables,
    prep,
    best_sellers: best,
    team,
    restaurant,
    hourly,
    yesterday,
    last_7_days: week,
    payment_mix: paymentMix,
    channel_mix: channel,
  } = summary;
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const occupancy = tables.total === 0 ? 0 : Math.round((tables.occupied / tables.total) * 100);

  // Trim the hourly axis to the trading day so far: every hour since the first
  // order (or the last six, before anything happens), up to now. A full 24
  // bars is mostly empty and makes the busy part unreadable.
  const nowHour = new Date().getHours();
  const firstActive = hourly.find((h) => h.orders > 0)?.hour;
  const from = Math.max(0, Math.min(firstActive ?? nowHour - 5, nowHour - 5));
  const hourBars = hourly.slice(from, nowHour + 1).map((h) => ({
    key: h.hour,
    label: `${h.hour}h`,
    value: h.value,
    orders: h.orders,
  }));
  const busiest = [...hourly].sort((a, b) => Number(b.value) - Number(a.value))[0];

  const weekBars = week.map((d) => ({
    key: d.day,
    label: new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }),
    value: d.value,
    orders: d.orders,
  }));

  const METHOD_COLOR = { cash: 'bg-emerald-500', card: 'bg-teal-600', upi: 'bg-amber-500' };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">{restaurant.name}</h2>
            <p className="text-sm font-semibold text-gray-600">{today}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onNavigate('pos')}
              className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-700"
            >
              <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Open POS
            </button>
            <button
              type="button"
              onClick={() => onNavigate('board')}
              className="flex items-center gap-1.5 rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-50"
            >
              <ClipboardList className="h-4 w-4" aria-hidden="true" /> Order board
            </button>
          </div>
        </div>

        {/* Taken and owed are separate on purpose — one is in the till, the
            other is sitting on tables. See services/dashboard.js. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Taken today"
            value={formatMoney(money.taken_today)}
            sub={`${money.paid_orders_today} ${money.paid_orders_today === 1 ? 'bill' : 'bills'} settled`}
            tone="accent"
            footer={<Delta today={money.ordered_today} yesterday={yesterday.takings} />}
          />
          <Tile
            label="Open on tables"
            value={formatMoney(money.open_on_tables)}
            sub={Number(money.open_on_tables) > 0 ? 'Not yet collected' : 'Nothing outstanding'}
            tone={Number(money.open_on_tables) > 0 ? 'warn' : 'plain'}
          />
          <Tile
            label="Average order"
            value={money.average_order === null ? '—' : formatMoney(money.average_order)}
            sub={`${money.orders_today} ${money.orders_today === 1 ? 'order' : 'orders'} today`}
            Icon={TrendingUp}
            footer={<Delta today={money.orders_today} yesterday={yesterday.orders} unit="orders" />}
          />
          <Tile
            label="Tables in use"
            value={`${tables.occupied}/${tables.total}`}
            sub={`${occupancy}% of the floor`}
            tone={occupancy >= 80 ? 'warn' : 'plain'}
          />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Right now</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QueueTile label="Awaiting approval" count={kitchen.awaiting_approval} tone="warn" onClick={() => onNavigate('pos')} />
            <QueueTile label="New" count={kitchen.placed} tone="warn" onClick={() => onNavigate('board')} />
            <QueueTile label="Preparing" count={kitchen.preparing} tone="accent" onClick={() => onNavigate('board')} />
            <QueueTile label="Ready" count={kitchen.ready} tone="good" onClick={() => onNavigate('board')} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600">Sales by hour</h3>
            {Number(busiest?.value ?? 0) > 0 && (
              <p className="text-xs font-semibold text-gray-600">
                Busiest {busiest.hour}:00 — {formatMoney(busiest.value)}
              </p>
            )}
          </div>
          <BarChart bars={hourBars} highlightKey={nowHour} emptyLabel="No orders yet today." />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-600">How people paid</h3>
            <SplitBar
              segments={paymentMix.map((m) => ({
                label: m.method,
                value: m.amount,
                color: METHOD_COLOR[m.method] ?? 'bg-gray-400',
              }))}
              emptyLabel="Nothing settled yet today."
            />
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-600">Where orders came from</h3>
            <SplitBar
              segments={[
                { label: `QR (${channel.qr_orders})`, value: channel.qr_value, color: 'bg-teal-600' },
                { label: `Counter (${channel.counter_orders})`, value: channel.counter_value, color: 'bg-amber-500' },
              ]}
              emptyLabel="No orders yet today."
            />
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Last 7 days</h3>
          <BarChart bars={weekBars} highlightKey={weekBars.at(-1)?.key} emptyLabel="No orders in the last week." />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Avg prep time"
            value={prep.average_minutes === null ? '—' : `${prep.average_minutes}m`}
            sub={prep.sampled === 0 ? 'Nothing cooked yet today' : `Across ${prep.sampled} today`}
            Icon={Timer}
          />
          <Tile
            label="Cancelled today"
            value={money.cancelled_today}
            sub={money.cancelled_today === 0 ? 'None' : 'Worth a look'}
            tone={money.cancelled_today > 0 ? 'bad' : 'plain'}
            Icon={Ban}
          />
          <Tile
            label="Items 86'd"
            value={team.unavailable_items}
            sub={team.unavailable_items === 0 ? 'Full menu available' : 'Hidden from the menu'}
            tone={team.unavailable_items > 0 ? 'warn' : 'plain'}
            Icon={EyeOff}
          />
          <Tile label="Team" value={team.members} sub="People with access" Icon={Users} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Selling today</h3>
          <div className="rounded-2xl border border-gray-200 bg-white">
            {best.length === 0 ? (
              <p className="p-4 text-sm font-semibold text-gray-700">Nothing ordered yet today.</p>
            ) : (
              best.map((item, i) => (
                <div key={item.name} className="flex items-center gap-3 border-b border-gray-200 p-4 last:border-b-0">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-teal-50 text-sm font-bold text-teal-700">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{item.name}</span>
                  <span className="flex-none text-sm font-bold text-gray-700 tabular-nums">× {item.quantity}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
