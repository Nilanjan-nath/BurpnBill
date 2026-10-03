import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { adminApi } from './adminApi.js';
import { useLoad } from './useLoad.js';
import { Problem, when } from './ui.jsx';
import { formatMoney } from '../format.js';

const PANEL = 'm-auto w-[min(40rem,94vw)] rounded-card bg-paper p-0 text-ink-900 shadow-pop backdrop:bg-ink-900/50';
const METHOD = { upi: 'UPI', bank_transfer: 'Bank transfer', cash: 'Cash', other: 'Other' };

// The invoice as the café receives it. Read from the frozen snapshot on the server,
// so opening it next year shows what was sent then. No tax lines on purpose: whether
// and how one is shown depends on the seller's registration, which is for an
// accountant to settle, so the document says only what is certain.
function InvoiceDocument({ invoice }) {
  const { seller, buyer } = invoice;
  return (
    <article className="bnb-invoice p-6 text-sm text-ink-900" aria-label={`Invoice ${invoice.number}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-300 pb-4">
        <div>
          <h2 className="font-display text-2xl font-extrabold">Invoice</h2>
          <p className="font-mono text-sm font-bold">{invoice.number}</p>
        </div>
        <dl className="text-right text-xs font-semibold text-ink-700">
          <div>Issued {when(invoice.issued_on)}</div>
          <div>Paid {when(invoice.paid_on)}</div>
        </dl>
      </header>

      <div className="grid gap-4 py-4 sm:grid-cols-2">
        <section aria-label="From">
          <h3 className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">From</h3>
          <p className="font-bold">{seller.name}</p>
          {seller.address && <p className="whitespace-pre-line font-semibold text-ink-800">{seller.address}</p>}
          {seller.phone && <p className="font-semibold text-ink-800">{seller.phone}</p>}
          {seller.email && <p className="font-semibold text-ink-800">{seller.email}</p>}
          {seller.tax_id && <p className="font-semibold text-ink-800">{seller.tax_id}</p>}
        </section>
        <section aria-label="To">
          <h3 className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-ink-600">To</h3>
          <p className="font-bold">{buyer.name}</p>
          {buyer.address && <p className="whitespace-pre-line font-semibold text-ink-800">{buyer.address}</p>}
          {buyer.phone && <p className="font-semibold text-ink-800">{buyer.phone}</p>}
          {buyer.email && <p className="font-semibold text-ink-800">{buyer.email}</p>}
        </section>
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-y border-ink-300 font-mono text-xs uppercase tracking-[0.06em] text-ink-600">
            <th className="py-2 pr-2">Description</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-ink-200 align-top">
            <td className="py-3 pr-2">
              <div className="font-bold">{invoice.description}</div>
              <div className="text-xs font-semibold text-ink-700">
                {when(invoice.period_start)} to {when(invoice.period_end)}
              </div>
            </td>
            <td className="py-3 text-right font-bold">{formatMoney(invoice.amount, invoice.currency_code)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th className="pt-3 pr-2 text-right font-extrabold">Total paid</th>
            <td className="pt-3 text-right text-lg font-extrabold">{formatMoney(invoice.amount, invoice.currency_code)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-4 text-xs font-semibold text-ink-700">
        Paid by {METHOD[invoice.method] ?? invoice.method}
        {invoice.reference ? `, reference ${invoice.reference}` : ''}. Thank you.
      </p>
    </article>
  );
}

// Printed through a portal to <body>, never from inside the dialog: a modal lives in
// the browser's top layer and browsers print that inconsistently. The print rules
// hide #root and show only .bnb-print-invoice (staff/tailwind.css).
export function InvoiceDialog({ token, paymentId, onClose }) {
  const dialog = useRef(null);
  const { data, error } = useLoad(() => adminApi.invoice(token, paymentId), `${token}|${paymentId}`);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <>
      <dialog ref={dialog} className={PANEL} aria-label="Invoice" onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3 print:hidden">
          <button
            type="button"
            disabled={!data}
            onClick={() => window.print()}
            className="flex min-h-11 items-center gap-1.5 rounded-input bg-brand px-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print or save as PDF
          </button>
          <button type="button" aria-label="Close" onClick={() => dialog.current.close()} className="flex h-11 w-11 items-center justify-center rounded-input text-ink-600 hover:bg-ink-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {error && <div className="p-4"><Problem>{error}</Problem></div>}
        {!data && !error && <p className="p-8 text-center text-sm font-semibold text-ink-700">Loading…</p>}
        {data && <InvoiceDocument invoice={data.invoice} />}
      </dialog>
      {data && createPortal(<div className="bnb-print-invoice"><InvoiceDocument invoice={data.invoice} /></div>, document.body)}
    </>
  );
}
