import { useCallback, useEffect, useState } from 'react';
import { useOrdering } from '../useOrdering.js';
import { Banners } from '../components/Banners.jsx';
import { BillScreen } from '../components/BillScreen.jsx';
import { CartScreen } from '../components/CartScreen.jsx';
import { Confirmation } from '../components/Confirmation.jsx';
import { MenuScreen } from '../components/MenuScreen.jsx';
import { StateScreen } from '../components/StateScreen.jsx';
import './tailwind.css';

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

export default function CustomerApp({ qrToken }) {
  const o = useOrdering(qrToken);
  const nav = usePage();
  const { showMenu } = nav;

  // A placed order lands on its confirmation, not back on the cart page it came from.
  const placedOrder = o.order;
  useEffect(() => {
    if (placedOrder) showMenu();
  }, [placedOrder, showMenu]);

  if (o.phase === 'loading') return <StateScreen title="Loading the menu…">One moment.</StateScreen>;
  if (o.phase === 'not_found') {
    return <StateScreen title="We don't recognise this QR code">Please ask a member of staff for help.</StateScreen>;
  }
  if (o.phase === 'closed') {
    return (
      <StateScreen title="Ordering is paused">
        Ordering isn't available at this table right now. Please ask a member of staff.
      </StateScreen>
    );
  }
  if (o.phase === 'error') {
    return (
      <StateScreen title="Couldn't load the menu" action={{ label: 'Try again', onClick: o.retryLoad }}>
        {o.problem}
      </StateScreen>
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

  // The outer div carries the page colour edge to edge, so a wide desktop
  // window doesn't show the stylesheet's own body colour either side of the
  // phone-width column. Every surface declares its own background and text
  // colour rather than inheriting whatever is underneath (docs/design.md).
  return (
    <div className="min-h-dvh bg-white text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto max-w-xl">
        <Banners
          notice={o.notice}
          problem={o.problem}
          onDismissNotice={o.dismissNotice}
          onDismissProblem={o.dismissProblem}
        />
        {screen}
      </div>
    </div>
  );
}
