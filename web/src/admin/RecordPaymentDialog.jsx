import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { adminApi } from './adminApi.js';
import { StaffApiError } from '../staff/staffApi.js';
import { formatMoney } from '../format.js';
import { Problem, when } from './ui.jsx';

const PANEL = 'm-auto w-[min(30rem,94vw)] rounded-card bg-paper p-0 text-ink-900 shadow-pop backdrop:bg-ink-900/50';
const FIELD =
  'mt-1 min-h-11 w-full rounded-input border border-ink-300 bg-paper px-3 text-sm font-semibold text-ink-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
const LABEL = 'font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600';

// Record money that HAS ALREADY ARRIVED. Nothing here takes a payment: you check
// your bank or UPI app first, then write down what you saw.
export function RecordPaymentDialog({ token, cafe, defaults, onClose, onRecorded }) {
  const dialog = useRef(null);
  const [amount, setAmount] = useState(defaults.amount);
  const [method, setMethod] = useState('upi');
  const [reference, setReference] = useState('');
  const [months, setMonths] = useState(defaults.months);
  const [problem, setProblem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  // Where the paid period will start: the later of today, the end of the trial and
  // the end of the plan they are already on. Shown so the number is no surprise.
  const startsAt = new Date(Math.max(Date.now(), new Date(cafe.trial_ends_at).getTime(), cafe.paid_until ? new Date(cafe.paid_until).getTime() : 0));

  const submit = async (e) => {
    e.preventDefault();
    setProblem(null);
    setSaving(true);
    try {
      const result = await adminApi.recordPayment(token, cafe.id, {
        amount,
        method,
        months: Number(months),
        ...(reference.trim() && { reference: reference.trim() }),
      });
      setDone(result);
      onRecorded(result);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setProblem(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialog} className={PANEL} aria-label={`Record a payment from ${cafe.name}`} onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold">Record a payment</h2>
            <p className="text-sm font-semibold text-ink-600">{cafe.name}. Only after the money has arrived.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => dialog.current.close()} className="flex h-11 w-11 items-center justify-center rounded-input text-ink-600 hover:bg-ink-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {done ? (
          <div className="space-y-3" role="status">
            <p className="rounded-input border border-butter-500 bg-butter-100 px-3 py-2 text-sm font-bold">
              Recorded as {done.payment.invoice_number}. Paid until {when(done.payment.period_end)}.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => dialog.current.close()} className="min-h-11 rounded-input border-2 border-ink-300 px-4 text-sm font-bold hover:bg-ink-50">
                Done
              </button>
              <button type="button" onClick={() => onRecorded(done, { openInvoice: true })} className="min-h-11 rounded-input bg-brand px-4 text-sm font-bold text-white hover:bg-brand-700">
                Open the invoice
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={LABEL}>Amount received (₹)</span>
                <input className={FIELD} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </label>
              <label className="block">
                <span className={LABEL}>How they paid</span>
                <select className={FIELD} value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className={LABEL}>Reference <span className="font-semibold normal-case text-ink-500">(UTR; the same one cannot be recorded twice)</span></span>
              <input className={FIELD} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <label className="block">
              <span className={LABEL}>Months covered</span>
              <input className={FIELD} type="number" min="1" max="36" value={months} onChange={(e) => setMonths(e.target.value)} required />
            </label>
            <p className="text-sm font-semibold text-ink-700">
              Covers {months} {Number(months) === 1 ? 'month' : 'months'} from {when(startsAt.toISOString())}
              {startsAt.getTime() > Date.now() + 60_000 ? ', when the trial or current plan ends' : ''}. {formatMoney(amount || 0)} received.
            </p>
            {problem && <Problem>{problem}</Problem>}
            <div className="flex gap-2">
              <button type="button" onClick={() => dialog.current.close()} className="min-h-11 rounded-input border-2 border-ink-300 px-4 text-sm font-bold hover:bg-ink-50">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="min-h-11 rounded-input bg-brand px-4 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
                {saving ? 'Recording…' : 'Record payment'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
