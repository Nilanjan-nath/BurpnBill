import { useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { adminApi } from './adminApi.js';
import { useLoad } from './useLoad.js';
import { StaffApiError } from '../staff/staffApi.js';
import { PlanPill, Money, Tile, Problem, Change, when, ago } from './ui.jsx';
import { shiftMonth, monthLabel } from './MonthlyReport.jsx';
import { RecordPaymentDialog } from './RecordPaymentDialog.jsx';
import { InvoiceDialog } from './InvoiceDialog.jsx';
import { formatMoney, plural } from '../format.js';

const METHOD = { upi: 'UPI', bank_transfer: 'Bank transfer', cash: 'Cash', other: 'Other' };
const EVENT = { trial_extended: 'Trial extended', payment_recorded: 'Payment recorded' };

// One day per bar, stacked: customers' QR orders in the brand colour, counter (POS)
// orders in butter. Every bar carries its own label, so the chart is readable by
// keyboard and screen reader and not only by someone who can see it.
function DailyBars({ daily }) {
  const max = Math.max(...daily.map((d) => d.qr_orders + d.pos_orders), 0);
  if (max === 0) return <p className="py-8 text-center text-sm font-semibold text-ink-700">No orders this month.</p>;
  return (
    <div className="flex h-40 items-end gap-0.5 overflow-x-auto" role="list" aria-label="Orders per day">
      {daily.map((d) => {
        const total = d.qr_orders + d.pos_orders;
        return (
          <div key={d.day} role="listitem" className="flex h-full min-w-3 flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.qr_orders} QR, ${d.pos_orders} POS, ${formatMoney(d.sales)} taken`}>
            <div
              tabIndex={0}
              role="img"
              aria-label={`${d.day}: ${d.qr_orders} QR orders, ${d.pos_orders} POS orders, ${formatMoney(d.sales)} taken`}
              className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              style={{ height: `${(total / max) * 100}%` }}
            >
              <div className="bg-butter-300" style={{ flexGrow: d.pos_orders }} />
              <div className="bg-brand" style={{ flexGrow: d.qr_orders }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CafeDetail({ token, cafeId, onBack }) {
  const [month, setMonth] = useState(undefined);
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => adminApi.restaurant(token, cafeId, month), `${token}|${cafeId}|${month}|${tick}`);
  const [paying, setPaying] = useState(false);
  const [invoiceId, setInvoiceId] = useState(null);
  const [days, setDays] = useState(7);
  const [extendError, setExtendError] = useState(null);
  const [extended, setExtended] = useState(false);

  if (error && !data) return <div className="space-y-3"><BackButton onBack={onBack} /><Problem>{error}</Problem></div>;
  if (!data) return <p className="p-10 text-center text-sm font-semibold text-ink-700">Loading…</p>;
  const { cafe, figures: f } = data;

  const extend = async () => {
    setExtendError(null);
    setExtended(false);
    try {
      await adminApi.extendTrial(token, cafeId, Number(days));
      setExtended(true);
      setTick((n) => n + 1);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setExtendError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <BackButton onBack={onBack} />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-extrabold text-ink-900">{cafe.name}</h2>
          <p className="text-sm font-semibold text-ink-700">
            {cafe.owner_email ?? 'no email on file'} · joined {when(cafe.created_at)} · {plural(cafe.tables, 'table')} · {plural(cafe.team_size, 'person', 'people')} on the team
          </p>
          <p className="mt-2"><PlanPill plan={cafe.plan} /></p>
          <p className="mt-1 text-xs font-semibold text-ink-600">
            Trial {new Date(cafe.trial_ends_at) > new Date() ? 'ends' : 'ended'} {when(cafe.trial_ends_at)}
            {cafe.paid_until ? ` · paid until ${when(cafe.paid_until)}` : ' · never paid'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPaying(true)} className="min-h-11 rounded-input bg-brand px-4 text-sm font-bold text-white hover:bg-brand-700">
            Record payment
          </button>
        </div>
      </header>

      <section aria-label="Extend the trial" className="flex flex-wrap items-center gap-2 rounded-card border border-ink-200 bg-paper p-3">
        <label className="text-sm font-bold text-ink-900" htmlFor="extend-days">Extend the trial by</label>
        <select id="extend-days" value={days} onChange={(e) => setDays(e.target.value)} className="min-h-11 rounded-input border border-ink-300 bg-paper px-2 text-sm font-semibold">
          {[3, 7, 14, 30].map((d) => (
            <option key={d} value={d}>{d} days</option>
          ))}
        </select>
        <button type="button" onClick={extend} className="min-h-11 rounded-input border-2 border-ink-300 px-3 text-sm font-bold hover:bg-ink-50">
          Extend trial
        </button>
        {extended && <span className="text-sm font-bold text-ready-ink" role="status">Trial extended.</span>}
        {extendError && <Problem>{extendError}</Problem>}
      </section>

      <section aria-label="This month" className="space-y-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(data.month, -1))} className="flex h-11 w-11 items-center justify-center rounded-input border border-ink-300 hover:bg-ink-50">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <h3 className="min-w-40 text-center text-lg font-extrabold text-ink-900">{monthLabel(data.month)}</h3>
          <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(data.month, 1))} className="flex h-11 w-11 items-center justify-center rounded-input border border-ink-300 hover:bg-ink-50">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {f && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="QR orders" value={f.qr_orders} />
            <Tile label="POS orders" value={f.pos_orders} />
            <Tile label="Sales (taken)" value={<Money value={f.sales} />} hint={<>vs last month <Change value={f.change.sales} /></>} />
            <Tile label="Order value" value={<Money value={f.order_value} />} />
            <Tile label="Avg order" value={<Money value={f.average_order} />} hint={`Last order ${ago(f.last_order_at)}`} />
          </div>
        )}
        <div className="rounded-card border border-ink-200 bg-paper p-4">
          <DailyBars daily={data.daily} />
          <p className="mt-2 flex gap-4 text-xs font-semibold text-ink-700">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-brand align-middle" aria-hidden="true" />QR (customers)</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-butter-300 align-middle" aria-hidden="true" />POS (counter)</span>
          </p>
        </div>
      </section>

      <section aria-label="Payments">
        <h3 className="mb-2 text-lg font-extrabold text-ink-900">Payments received</h3>
        {data.payments.length === 0 ? (
          <p className="text-sm font-semibold text-ink-700">Nothing recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-ink-200 bg-paper">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 font-mono text-xs uppercase tracking-[0.06em] text-ink-600">
                  <th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Paid</th><th className="px-3 py-2">How</th>
                  <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Covers</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-b border-ink-200 last:border-b-0">
                    <td className="px-3 py-2.5 font-mono font-bold">{p.invoice_number}</td>
                    <td className="px-3 py-2.5 font-semibold">{when(p.paid_on)}</td>
                    <td className="px-3 py-2.5 font-semibold">{METHOD[p.method]}{p.reference ? ` · ${p.reference}` : ''}</td>
                    <td className="px-3 py-2.5 text-right font-bold"><Money value={p.amount} /></td>
                    <td className="px-3 py-2.5 font-semibold">{when(p.period_start)} to {when(p.period_end)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" aria-label={`Open invoice ${p.invoice_number}`} onClick={() => setInvoiceId(p.id)} className="min-h-10 rounded-input border border-ink-300 px-3 text-xs font-bold hover:bg-ink-50">
                        Invoice
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.events.length > 0 && (
        <section aria-label="Activity">
          <h3 className="mb-2 text-sm font-extrabold text-ink-900">Plan activity</h3>
          <ul className="space-y-1 text-sm font-semibold text-ink-700">
            {data.events.map((e, i) => (
              <li key={i}>{when(e.created_at)}: {EVENT[e.kind] ?? e.kind}{e.data?.days ? ` by ${e.data.days} days` : ''}{e.data?.invoice ? ` (${e.data.invoice})` : ''}</li>
            ))}
          </ul>
        </section>
      )}

      {paying && (
        <RecordPaymentDialog
          token={token}
          cafe={cafe}
          defaults={data.plan_defaults}
          onClose={() => setPaying(false)}
          onRecorded={(result, opts) => {
            setTick((n) => n + 1);
            if (opts?.openInvoice) {
              setPaying(false);
              setInvoiceId(result.payment.id);
            }
          }}
        />
      )}
      {invoiceId && <InvoiceDialog token={token} paymentId={invoiceId} onClose={() => setInvoiceId(null)} />}
    </div>
  );
}

function BackButton({ onBack }) {
  return (
    <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-1.5 rounded-input px-1 text-sm font-bold text-brand hover:text-brand-700">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All cafés
    </button>
  );
}
