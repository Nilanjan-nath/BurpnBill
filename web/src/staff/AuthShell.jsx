import { useEffect } from 'react';
import { Logo } from '../brand/Logo.jsx';

// The frame every pre-dashboard screen shares — sign in, sign up, "create your
// café", the loading and error states in StaffApp — so someone arriving here
// from the landing page sees the same brand they just left instead of a bare
// form. It replaces staff.css's `.staff-centered`, which was the last thing
// that stylesheet did.
export function AuthShell({ children }) {
  // index.html's title belongs to the customer app, which shares the shell; the
  // board sets its own once you are in (useNewOrderAlerts).
  useEffect(() => {
    document.title = 'BurpnBill — Staff';
  }, []);
  return (
    <main className="brand-surface staff-app flex min-h-dvh flex-col items-center justify-center gap-8 bg-canvas px-4 py-10 text-ink-900">
      <a href="/" aria-label="BurpnBill home" className="rounded-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
        <Logo variant="white" width={152} />
      </a>
      {children}
    </main>
  );
}
