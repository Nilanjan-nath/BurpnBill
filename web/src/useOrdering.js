import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.js';
import { storage } from './storage.js';

const EMPTY_CART = { cart_id: null, items: [], subtotal: '0.00', has_unavailable_items: false };

const SESSION_LOST = 'Your session expired, so your cart was cleared. Please add your items again.';
const ORDER_UNCONFIRMED =
  "We couldn't reach the server, so your order may not have gone through. Tap Place order again — it can't be placed twice.";

// Everything the customer screens need: the menu, the server-side cart, the
// placed order, and the recovery from each thing that can go wrong.
//
// The server owns the cart and all prices; this hook only mirrors what the
// server last said. Actions run one at a time (`busy`), so a double-tap can't
// send two requests, and placing an order names its cart, so even a retry
// after a dropped connection can't create a second order.
export function useOrdering(qrToken) {
  const [phase, setPhase] = useState('loading'); // loading | ready | closed | not_found | error
  const [menu, setMenu] = useState(null);
  const [cart, setCart] = useState(EMPTY_CART);
  const [order, setOrder] = useState(null); // the order just placed, for the confirmation screen
  const [hasOrders, setHasOrders] = useState(false); // does this session have any orders (bill button)
  const [bill, setBill] = useState(null);
  const [billError, setBillError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);

  const session = useRef(null);
  const inFlight = useRef(false);
  const syncing = useRef(null);

  // Loads the menu (which also starts or refreshes the guest session) and the cart.
  // Overlapping calls (a dev-mode double effect, or the tab becoming visible
  // mid-load) share one request, so a page open makes one guest session, not three.
  const load = useCallback(
    async ({ initial = false } = {}) => {
      try {
        const stored = session.current ?? storage.getSession(qrToken);
        const data = await api.openMenu(qrToken, stored);
        const sessionId = data.session.id;
        const reused = sessionId === stored;
        const nextCart = reused ? await api.getCart(sessionId) : EMPTY_CART;

        session.current = sessionId;
        storage.saveSession(qrToken, sessionId);
        setMenu({ restaurant: data.restaurant, table: data.table, categories: data.categories });
        setCart(nextCart);
        setHasOrders(data.session.has_orders);
        setPhase('ready');
        // The page was open with a session that has since expired.
        if (!reused && stored && !initial) setNotice(SESSION_LOST);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (err.status === 404) setPhase('not_found');
        else if (err.code === 'ordering_unavailable') setPhase('closed');
        else if (initial) {
          setProblem(err.message);
          setPhase('error');
        }
        // A background refresh that fails (no signal) keeps what's on screen.
      }
    },
    [qrToken],
  );

  const sync = useCallback(
    (options) => {
      syncing.current ??= load(options).finally(() => {
        syncing.current = null;
      });
      return syncing.current;
    },
    [load],
  );

  useEffect(() => {
    sync({ initial: true });
  }, [sync]);

  // Coming back to the tab: the menu may have changed (an item 86'd) while
  // the phone was in a pocket. Correctness of the menu beats a stale cache.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !inFlight.current) sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sync]);

  // Runs one action at a time and turns failures into something the customer can act on.
  const run = useCallback(
    async (action) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setProblem(null);
      try {
        await action();
        return true;
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (err.isSessionProblem) {
          session.current = null;
          storage.clearSession(qrToken);
          await sync();
          setNotice(SESSION_LOST);
        } else if (err.code === 'ordering_unavailable') {
          setPhase('closed');
        } else {
          setProblem(err.message);
          if (err.code === 'item_unavailable') await sync();
        }
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [qrToken, sync],
  );

  const addItem = (menuItemId, quantity, note) =>
    run(async () => {
      setNotice(null);
      setCart(await api.addItem(session.current, { menu_item_id: menuItemId, quantity, special_instructions: note || null }));
    });

  const setQuantity = (line, quantity) =>
    run(async () => {
      setCart(
        quantity < 1
          ? await api.removeItem(session.current, line.id)
          : await api.updateItem(session.current, line.id, { quantity }),
      );
    });

  const setNote = (line, note) =>
    run(async () => {
      setCart(await api.updateItem(session.current, line.id, { special_instructions: note || null }));
    });

  const removeLine = (line) =>
    run(async () => {
      setCart(await api.removeItem(session.current, line.id));
    });

  // After a sold-out warning: drop every line the server says is unavailable.
  const removeUnavailable = () =>
    run(async () => {
      let latest = cart;
      for (const line of cart.items.filter((l) => !l.available)) {
        latest = await api.removeItem(session.current, line.id);
      }
      setCart(latest);
    });

  const placeOrder = () =>
    run(async () => {
      setNotice(null);
      try {
        const { order: placed } = await api.placeOrder(session.current, cart.cart_id);
        setOrder(placed);
        setHasOrders(true);
        setCart(EMPTY_CART);
      } catch (err) {
        if (err.code === 'items_unavailable') {
          await sync(); // refreshes the menu and flags the sold-out lines in the cart
          setProblem('Some items just sold out. Remove them to continue.');
        } else if (err.code === 'network') {
          setProblem(ORDER_UNCONFIRMED);
        } else {
          throw err;
        }
      }
    });

  const startNewOrder = () => setOrder(null);

  // The bill: everything this session has ordered, read fresh from the server.
  const loadBill = useCallback(async () => {
    setBillError(null);
    try {
      const latest = await api.getBill(session.current);
      setBill(latest);
      setHasOrders(latest.orders.length > 0);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.isSessionProblem) {
        session.current = null;
        storage.clearSession(qrToken);
        setBill(null);
        await sync();
        setNotice(SESSION_LOST);
      } else {
        setBillError(err.message);
      }
    }
  }, [qrToken, sync]);

  // Where this session's orders are in the kitchen. A stable function reading the
  // session ref, so useOrderStatus's effect isn't restarted by every render.
  const fetchStatus = useCallback(() => api.getOrderStatus(session.current), []);

  return {
    phase, menu, cart, order, hasOrders, bill, billError, notice, problem, busy, fetchStatus,
    addItem, setQuantity, setNote, removeLine, removeUnavailable, placeOrder, startNewOrder, loadBill,
    retryLoad: () => sync({ initial: true }),
    dismissNotice: () => setNotice(null),
    dismissProblem: () => setProblem(null),
  };
}
