import { useEffect, useState } from 'react';
import { Receipt } from './Receipt.jsx';
import './receipt-page.css';

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

// /r/<token> — the page the QR code on a printed receipt opens: the same bill,
// read-only, on the customer's phone. No login; the unguessable token in the
// address is the access (server/src/services/bills.js, getPublicReceipt).
//
// Its own chunk, with plain CSS: it is neither the dashboard nor the ordering
// app, and must not load either one's styles.
export default function ReceiptPage({ token }) {
  const [state, setState] = useState({ status: 'loading' }); // loading | ready | missing | error

  useEffect(() => {
    // A receipt is for whoever was handed the paper: keep it out of search results.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/receipts/${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (res.status === 404) return setState({ status: 'missing' });
        if (!res.ok) return setState({ status: 'error' });
        const { receipt } = await res.json();
        document.title = `Receipt ${String(receipt.bill_number).padStart(4, '0')} — ${receipt.restaurant_name}`;
        setState({ status: 'ready', receipt });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <main className="rcpt-page">
        <p className="rcpt-note">Loading your receipt…</p>
      </main>
    );
  }
  if (state.status === 'missing') {
    return (
      <main className="rcpt-page">
        <h1 className="rcpt-heading">We can't find that receipt</h1>
        <p className="rcpt-note">The link may be mistyped. Ask the café to scan the code on your paper receipt again.</p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="rcpt-page">
        <h1 className="rcpt-heading">Couldn't load the receipt</h1>
        <p className="rcpt-note">Check your connection and open the link again.</p>
      </main>
    );
  }

  return (
    <main className="rcpt-page">
      <div className="rcpt-card">
        <Receipt bill={state.receipt} size="a4" showQr={false} />
      </div>
      <button type="button" className="rcpt-print" onClick={() => window.print()}>
        Print or save as PDF
      </button>
    </main>
  );
}
