import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useOrdering } from './useOrdering.js';
import { Banners } from './components/Banners.jsx';
import { BillScreen } from './components/BillScreen.jsx';
import { CartScreen } from './components/CartScreen.jsx';
import { Confirmation } from './components/Confirmation.jsx';
import { MenuScreen } from './components/MenuScreen.jsx';
import { Message } from './components/Message.jsx';

// Loaded only once someone actually opens /staff — a customer scanning a
// table's QR code never downloads any of the staff dashboard's code.
const StaffApp = lazy(() => import('./staff/StaffApp.jsx'));

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
    return (
      <Message title="Scan your table's QR code">
        Point your phone's camera at the QR code on your table to see the menu and order.
      </Message>
    );
  }
  return <Ordering key={qrToken} qrToken={qrToken} />;
}

// The cart and the bill are "pages" at #cart and #bill, so the phone's back
// button goes back to where you were instead of leaving the site.
const PAGES = ['cart', 'bill'];
const pageFromHash = () => PAGES.find((name) => window.location.hash === `#${name}`) ?? 'menu';

function usePage() {
  const [page, setPage] = useState(pageFromHash);

  useEffect(() => {
    const sync = () => setPage(pageFromHash());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const open = (name) => {
    window.history.pushState({ petukPage: name }, '', `#${name}`);
    setPage(name);
  };

  // Straight to the menu without a history step (after an order, or a reload on a sub-page).
  const showMenu = useCallback(() => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setPage('menu');
  }, []);

  const back = () => {
    if (window.history.state?.petukPage) window.history.back(); // popstate flips the page
    else showMenu(); // e.g. the page was reloaded while on #cart
  };

  return { page, open, back, showMenu };
}

function Ordering({ qrToken }) {
  const o = useOrdering(qrToken);
  const nav = usePage();
  const { showMenu } = nav;

  // A placed order lands on its confirmation, not back on the cart page it came from.
  const placedOrder = o.order;
  useEffect(() => {
    if (placedOrder) showMenu();
  }, [placedOrder, showMenu]);

  if (o.phase === 'loading') return <Message title="Loading the menu…">One moment.</Message>;
  if (o.phase === 'not_found') {
    return <Message title="We don't recognise this QR code">Please ask a member of staff for help.</Message>;
  }
  if (o.phase === 'closed') {
    return (
      <Message title="Ordering is paused">
        Ordering isn't available at this table right now. Please ask a member of staff.
      </Message>
    );
  }
  if (o.phase === 'error') {
    return (
      <Message title="Couldn't load the menu" action={{ label: 'Try again', onClick: o.retryLoad }}>
        {o.problem}
      </Message>
    );
  }

  const orderMore = () => {
    o.startNewOrder();
    nav.showMenu();
  };

  let screen;
  if (nav.page === 'bill') {
    screen = (
      <BillScreen bill={o.bill} error={o.billError} onLoad={o.loadBill} onBack={nav.back} onOrderMore={orderMore} />
    );
  } else if (o.order) {
    screen = (
      <Confirmation
        order={o.order}
        currency={o.menu.restaurant.currency_code}
        onViewBill={() => nav.open('bill')}
        onNewOrder={orderMore}
      />
    );
  } else if (nav.page === 'cart') {
    screen = (
      <CartScreen
        menu={o.menu}
        cart={o.cart}
        busy={o.busy}
        onBack={nav.back}
        onQuantity={o.setQuantity}
        onNote={o.setNote}
        onRemoveUnavailable={o.removeUnavailable}
        onPlaceOrder={o.placeOrder}
      />
    );
  } else {
    screen = (
      <MenuScreen
        menu={o.menu}
        cart={o.cart}
        hasOrders={o.hasOrders}
        busy={o.busy}
        onAdd={o.addItem}
        onOpenCart={() => nav.open('cart')}
        onOpenBill={() => nav.open('bill')}
      />
    );
  }

  return (
    <div className="app">
      <Banners
        notice={o.notice}
        problem={o.problem}
        onDismissNotice={o.dismissNotice}
        onDismissProblem={o.dismissProblem}
      />
      {screen}
    </div>
  );
}
