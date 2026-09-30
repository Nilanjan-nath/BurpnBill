import { ShoppingCart, ClipboardList, Timer, Ban, EyeOff, Users, TrendingUp } from 'lucide-react';
import { useDashboard } from './useDashboard.js';
import { BarChart, SplitBar, Delta } from './DashboardCharts.jsx';
import { formatMoney } from '../format.js';

// Today at a glance, for the owner. Deliberately plain: white tiles with dark
// mono numbers, and colour only where it means something — money still owed, a
// queue waiting on someone, a cancellation. (Never crimson for a number: in the
// brand system crimson means "do this", and nothing here is asking to be done.) A wall of pastel tiles (as in the
// reference) reads as decoration, and this screen exists to be scanned in
// five seconds. See docs/design.md's "what color is not for".
function Tile({ label, value, sub, tone = 'plain', Icon, footer }) {
  const TONE = {
    plain: 'text-ink-900',
    accent: 'text-ink-900',
    warn: 'text-placed-ink',
    bad: 'text-danger-700',
    good: 'text-ready-ink',
  };
  return (
    <div className="rounded-card border border-ink-200 bg-paper p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">{label}</p>
        {Icon && <Icon className="h-4 w-4 flex-none text-ink-500" aria-hidden="true" />}
      </div>
      <p className={`mt-2 font-mono text-2xl font-bold tabular-nums ${TONE[tone]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs font-semibold text-ink-600">{sub}</p>}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

// A count that is also a way in — tapping it goes where the work is.
function QueueTile({ label, count, tone, onClick }) {
  const TONE = {
    warn: 'border-placed-ink/30 bg-placed text-placed-ink',
    accent: 'border-prep-ink/30 bg-prep text-prep-ink',
    good: 'border-ready-ink/30 bg-ready text-ready-ink',
    plain: 'border-ink-200 bg-paper text-ink-900',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-card border p-4 text-left transition duration-150 ease-tap active:scale-[0.98] ${count > 0 ? TONE[tone] : TONE.plain}`}
    >
      <p className="font-mono text-xs font-bold uppercase tracking-[0.08em]">{label}</p>
      <p className="mt-2 font-mono text-2xl font-bold tabular-nums">{count}</p>
    </button>
  );
}

export function DashboardHome({ token, onNavigate }) {
  const { summary, error } = useDashboard(token);

  if (error) {
    return (
      <div className="p-6">
        <p className="rounded-card border border-danger-200 bg-danger-50 px-4 py-2.5 text-sm font-semibold text-danger-700" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!summary) return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading today…</p>;

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

  // Categorical, so three distinct hues from the brand: ink, crimson, butter.
  const METHOD_COLOR = { cash: 'bg-ink-700', card: 'bg-brand', upi: 'bg-butter-500' };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">{restaurant.name}</h2>
            <p className="text-sm font-semibold text-ink-600">{today}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onNavigate('pos')}
              className="flex min-h-12 items-center gap-1.5 rounded-card bg-brand px-4 text-sm font-bold text-white transition duration-150 ease-tap hover:bg-brand-700 active:scale-[0.98]"
            >
              <ShoppingCart className="h-4 w-4" aria-hidden="true" /> Open POS
            </button>
            <button
              type="button"
              onClick={() => onNavigate('board')}
              className="flex min-h-12 items-center gap-1.5 rounded-card border-2 border-ink-300 px-4 text-sm font-bold text-ink-800 transition duration-150 ease-tap hover:bg-ink-50 active:scale-[0.98]"
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
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">Right now</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QueueTile label="Awaiting approval" count={kitchen.awaiting_approval} tone="warn" onClick={() => onNavigate('pos')} />
            <QueueTile label="New" count={kitchen.placed} tone="warn" onClick={() => onNavigate('board')} />
            <QueueTile label="Preparing" count={kitchen.preparing} tone="accent" onClick={() => onNavigate('board')} />
            <QueueTile label="Ready" count={kitchen.ready} tone="good" onClick={() => onNavigate('board')} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">Sales by hour</h3>
            {Number(busiest?.value ?? 0) > 0 && (
              <p className="text-xs font-semibold text-ink-600">
                Busiest {busiest.hour}:00 — {formatMoney(busiest.value)}
              </p>
            )}
          </div>
          <BarChart bars={hourBars} highlightKey={nowHour} emptyLabel="No orders yet today." />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-card border border-ink-200 bg-paper p-4">
            <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">How people paid</h3>
            <SplitBar
              segments={paymentMix.map((m) => ({
                label: m.method,
                value: m.amount,
                color: METHOD_COLOR[m.method] ?? 'bg-ink-400',
              }))}
              emptyLabel="Nothing settled yet today."
            />
          </div>
          <div className="rounded-card border border-ink-200 bg-paper p-4">
            <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">Where orders came from</h3>
            <SplitBar
              segments={[
                { label: `QR (${channel.qr_orders})`, value: channel.qr_value, color: 'bg-brand' },
                { label: `Counter (${channel.counter_orders})`, value: channel.counter_value, color: 'bg-ink-700' },
              ]}
              emptyLabel="No orders yet today."
            />
          </div>
        </div>

        <div>
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">Last 7 days</h3>
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
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">Selling today</h3>
          <div className="rounded-card border border-ink-200 bg-paper">
            {best.length === 0 ? (
              <p className="p-4 text-sm font-semibold text-ink-700">Nothing ordered yet today.</p>
            ) : (
              best.map((item, i) => (
                <div key={item.name} className="flex items-center gap-3 border-b border-ink-200 p-4 last:border-b-0">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-butter-300 font-mono text-sm font-bold text-ink-900">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-900">{item.name}</span>
                  <span className="flex-none font-mono text-sm font-bold text-ink-700 tabular-nums">× {item.quantity}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
