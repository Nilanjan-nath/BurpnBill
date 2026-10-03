import { useEffect, useState } from 'react';
import { createStaffAuthClient } from '../staff/supabaseClient.js';
import { useStaffSession } from '../staff/useStaffSession.js';
import { SignInScreen } from '../staff/SignInScreen.jsx';
import { SetPasswordScreen } from '../staff/SetPasswordScreen.jsx';
import { AuthShell } from '../staff/AuthShell.jsx';
import { StaffApiError } from '../staff/staffApi.js';
import { Logo } from '../brand/Logo.jsx';
import { adminApi } from './adminApi.js';
import { Overview } from './Overview.jsx';
import { MonthlyReport } from './MonthlyReport.jsx';
import { CafesTab } from './CafesTab.jsx';
import { CafeDetail } from './CafeDetail.jsx';
import '../staff/tailwind.css';

// BurpnBill's own area, at /admin: every café side by side, who has paid, and the
// monthly numbers. Not part of any café's dashboard. It signs in with the same
// Supabase login as /staff, then asks the API whether that login is on the
// platform admin list (GET /api/admin/me); a login that is not shows a refusal and
// nothing else, and the API enforces it again on every call.
export default function AdminApp({ auth }) {
  const [client] = useState(() => {
    if (auth) return { ready: auth };
    try {
      return { ready: createStaffAuthClient() };
    } catch (err) {
      return { failed: err.message };
    }
  });
  if (client.failed) return <Centered>{client.failed}</Centered>;
  return <Authenticated auth={client.ready} />;
}

function Centered({ children }) {
  return (
    <AuthShell>
      <p className="text-center text-sm font-semibold text-ink-700">{children}</p>
    </AuthShell>
  );
}

function Authenticated({ auth }) {
  const session = useStaffSession(auth);
  if (session.token === undefined) return <Centered>Loading…</Centered>;
  if (session.token === null) return <SignInScreen session={session} />;
  if (session.invitation) return <SetPasswordScreen session={session} />;
  return <Gate key={session.token} token={session.token} onSignOut={session.signOut} />;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'report', label: 'Monthly report' },
  { id: 'cafes', label: 'Cafés' },
];

function Gate({ token, onSignOut }) {
  const [allowed, setAllowed] = useState(undefined); // undefined = asking
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .me(token)
      .then(() => !cancelled && setAllowed(true))
      .catch((err) => {
        if (cancelled) return;
        if (!(err instanceof StaffApiError)) throw err;
        if (err.status === 403) setAllowed(false);
        else setProblem(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (problem) return <Centered>{problem}</Centered>;
  if (allowed === undefined) return <Centered>Loading…</Centered>;
  if (!allowed) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm space-y-4 rounded-card border border-ink-200 bg-paper p-8 text-center">
          <h1 className="text-xl font-extrabold text-ink-900">Not allowed</h1>
          <p className="text-sm font-semibold text-ink-700">This login is not a BurpnBill admin.</p>
          <button type="button" onClick={onSignOut} className="min-h-12 w-full rounded-card border-2 border-ink-300 px-4 text-sm font-bold hover:bg-ink-50">
            Sign out
          </button>
        </div>
      </AuthShell>
    );
  }
  return <Console token={token} onSignOut={onSignOut} />;
}

function Console({ token, onSignOut }) {
  const [tab, setTab] = useState('overview');
  const [cafeId, setCafeId] = useState(null);

  const openCafe = (id) => setCafeId(id);
  const choose = (id) => {
    setTab(id);
    setCafeId(null);
  };

  return (
    <div className="brand-surface staff-app min-h-dvh bg-canvas text-ink-900">
      <header className="border-b border-ink-200 bg-paper print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo variant="white" width={112} />
            <span className="rounded-full bg-ink-900 px-2.5 py-0.5 font-mono text-xs font-bold uppercase tracking-[0.08em] text-butter-300">Admin</span>
          </div>
          <button type="button" onClick={onSignOut} className="min-h-11 rounded-input px-3 text-sm font-bold text-ink-700 hover:bg-ink-100">
            Sign out
          </button>
        </div>
        <nav aria-label="Admin" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id && !cafeId ? 'page' : undefined}
              onClick={() => choose(t.id)}
              className={`min-h-12 flex-none border-b-4 px-4 text-sm font-bold ${
                tab === t.id && !cafeId ? 'border-brand text-ink-900' : 'border-transparent text-ink-600 hover:text-ink-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 print:hidden">
        {cafeId ? (
          <CafeDetail token={token} cafeId={cafeId} onBack={() => setCafeId(null)} />
        ) : tab === 'overview' ? (
          <Overview token={token} onOpenCafe={openCafe} />
        ) : tab === 'report' ? (
          <MonthlyReport token={token} onOpenCafe={openCafe} />
        ) : (
          <CafesTab token={token} onOpenCafe={openCafe} />
        )}
      </main>
    </div>
  );
}
