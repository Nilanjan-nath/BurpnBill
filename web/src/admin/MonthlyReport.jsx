import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { adminApi } from './adminApi.js';
import { useLoad } from './useLoad.js';
import { Money, Change, Problem, ago } from './ui.jsx';
import { useState } from 'react';

// 'YYYY-MM' arithmetic, so the month buttons never touch a Date (and its zones).
export function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export const monthLabel = (month) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const CSV_COLUMNS = [
  ['Café', (c) => c.name],
  ['QR orders', (c) => c.qr_orders],
  ['POS orders', (c) => c.pos_orders],
  ['Orders', (c) => c.orders],
  ['Order value', (c) => c.order_value],
  ['Sales (money taken)', (c) => c.sales],
  ['Average order', (c) => c.average_order ?? ''],
  ['Cancelled or rejected', (c) => c.cancelled],
  ['Sales last month', (c) => c.previous.sales],
  ['Sales change %', (c) => c.change.sales ?? ''],
  ['Last order', (c) => c.last_order_at ?? ''],
];

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

// The table as a spreadsheet. Pure, so what is downloaded is what the test reads.
export function reportCsv(report) {
  const head = CSV_COLUMNS.map(([name]) => cell(name)).join(',');
  const rows = report.cafes.map((c) => CSV_COLUMNS.map(([, get]) => cell(get(c))).join(','));
  const t = report.totals;
  const total = ['All cafés', t.qr_orders, t.pos_orders, t.orders, t.order_value, t.sales, t.average_order ?? '', t.cancelled, t.previous.sales, t.change.sales ?? '', ''].map(cell).join(',');
  return [head, ...rows, total].join('\n');
}

function downloadCsv(report) {
  const blob = new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `burpnbill-report-${report.month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const TH = 'whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-bold uppercase tracking-[0.06em] text-ink-600';
const TD = 'whitespace-nowrap px-3 py-2.5 text-right text-sm font-semibold text-ink-900';

// Every café for one month, side by side, with a total and the change on last month.
//   Sales = money actually taken (settled bills). Order value = everything ordered
//   and accepted, settled or not. They answer different questions, so both show.
export function MonthlyReport({ token, onOpenCafe }) {
  const [month, setMonth] = useState(undefined); // undefined = the server's current month
  const { data, error } = useLoad(() => adminApi.report(token, month), `${token}|${month}`);

  if (error && !data) return <Problem>{error}</Problem>;
  if (!data) return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading…</p>;
  const t = data.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(data.month, -1))} className="flex h-11 w-11 items-center justify-center rounded-input border border-ink-300 hover:bg-ink-50">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <h2 className="min-w-40 text-center text-lg font-extrabold text-ink-900">{monthLabel(data.month)}</h2>
          <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(data.month, 1))} className="flex h-11 w-11 items-center justify-center rounded-input border border-ink-300 hover:bg-ink-50">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(data)}
          className="flex min-h-11 items-center gap-1.5 rounded-input border border-ink-300 px-3 text-sm font-bold text-ink-900 hover:bg-ink-50"
        >
          <Download className="h-4 w-4" aria-hidden="true" /> Download CSV
        </button>
      </div>
      {error && <Problem>{error}</Problem>}

      <p className="text-sm font-semibold text-ink-700">
        <b>Sales</b> is money actually taken (settled bills). <b>Order value</b> is everything ordered and accepted, settled or not. Compared with {monthLabel(data.previous_month)}.
      </p>

      <div className="overflow-x-auto rounded-card border border-ink-200 bg-paper">
        <table className="w-full min-w-[56rem] border-collapse" aria-label={`Report for ${monthLabel(data.month)}`}>
          <thead>
            <tr className="border-b border-ink-200">
              <th scope="col" className={`${TH} text-left`}>Café</th>
              <th scope="col" className={TH}>QR orders</th>
              <th scope="col" className={TH}>POS orders</th>
              <th scope="col" className={TH}>Order value</th>
              <th scope="col" className={TH}>Sales</th>
              <th scope="col" className={TH}>vs last month</th>
              <th scope="col" className={TH}>Avg order</th>
              <th scope="col" className={TH}>Cancelled</th>
              <th scope="col" className={TH}>Last order</th>
            </tr>
          </thead>
          <tbody>
            {data.cafes.map((c) => (
              <tr key={c.id} className="border-b border-ink-200 last:border-b-0">
                <th scope="row" className={`${TD} text-left`}>
                  <button type="button" onClick={() => onOpenCafe(c.id)} className="font-bold text-brand underline-offset-2 hover:underline">
                    {c.name}
                  </button>
                </th>
                <td className={TD}>{c.qr_orders}</td>
                <td className={TD}>{c.pos_orders}</td>
                <td className={TD}><Money value={c.order_value} /></td>
                <td className={`${TD} font-extrabold`}><Money value={c.sales} /></td>
                <td className={TD}><Change value={c.change.sales} /></td>
                <td className={TD}><Money value={c.average_order} /></td>
                <td className={TD}>{c.cancelled}</td>
                <td className={TD}>{ago(c.last_order_at)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink-300 bg-ink-50">
              <th scope="row" className={`${TD} text-left font-extrabold`}>All cafés ({t.cafes})</th>
              <td className={`${TD} font-extrabold`}>{t.qr_orders}</td>
              <td className={`${TD} font-extrabold`}>{t.pos_orders}</td>
              <td className={`${TD} font-extrabold`}><Money value={t.order_value} /></td>
              <td className={`${TD} font-extrabold`}><Money value={t.sales} /></td>
              <td className={TD}><Change value={t.change.sales} /></td>
              <td className={`${TD} font-extrabold`}><Money value={t.average_order} /></td>
              <td className={`${TD} font-extrabold`}>{t.cancelled}</td>
              <td className={TD} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
