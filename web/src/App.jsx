import { lazy, Suspense } from 'react';
import { Message } from './components/Message.jsx';

// Loaded only once someone actually opens /staff — a customer scanning a
// table's QR code never downloads any of the staff dashboard's code.
const StaffApp = lazy(() => import('./staff/StaffApp.jsx'));
// Same rule the other way: the landing page is for café owners, and a customer
// at a table should never pay for it either. Verified in the production build.
const LandingPage = lazy(() => import('./landing/LandingPage.jsx'));
// And the customer app is its own chunk for the third reason: it is Tailwind
// too, and Tailwind's preflight is global, so it may only load on /t/<token>.
const CustomerApp = lazy(() => import('./customer/CustomerApp.jsx'));

// The QR code encodes {APP_BASE_URL}/t/{qr_token}.
export function qrTokenFromPath(pathname) {
  const match = pathname.match(/^\/t\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const path = window.location.pathname;
  if (path === '/staff' || path.startsWith('/staff/')) {
    return (
      <Suspense fallback={<Message title="Loading…">One moment.</Message>}>
        <StaffApp />
      </Suspense>
    );
  }

  const qrToken = qrTokenFromPath(path);
  if (!qrToken) {
    // The bare address is where a café owner arrives, not a customer — a
    // customer arrives at /t/<token> with their camera. So / is the landing
    // page now; the line the customer used to get lives in its footer.
    return (
      <Suspense fallback={<Message title="Petuk">One moment.</Message>}>
        <LandingPage />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<Message title="Loading the menu…">One moment.</Message>}>
      <CustomerApp key={qrToken} qrToken={qrToken} />
    </Suspense>
  );
}
