import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';
import { useOrderStream } from './useOrderStream.js';

// POS (step 7 slices 2-3): the floor map, the menu to build a walk-in's
// order from, and the cart for whichever table is currently selected.
// Switching tables discards the in-progress cart on purpose — it isn't
// sent anywhere until "Send to kitchen", so there's nothing to lose, and
// carrying table A's half-built order onto table B by accident would be
// a real mistake on a busy floor.
export function usePOS(token) {
  const [tables, setTables] = useState(null); // null = still loading
  const [items, setItems] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [cart, setCart] = useState([]); // [{ menu_item_id, name, price, quantity }]
  const [error, setError] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(null); // table id currently being checked out
  const [bill, setBill] = useState(null); // the open checkout's bill, null = closed
  const [pending, setPending] = useState(null); // QR orders waiting for approval
  const [deciding, setDeciding] = useState(null); // order id currently being approved/rejected

  const loadFloor = useCallback(async () => {
    if (!token) return;
    try {
      const data = await staffApi.getFloor(token);
      setTables(data.tables);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token]);

  const loadPending = useCallback(async () => {
    if (!token) return;
    try {
      const data = await staffApi.getPendingOrders(token);
      setPending(data.orders);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    loadFloor();
    loadPending();
  }, [loadFloor, loadPending]);

  // POS opens its own stream rather than sharing the board's. An order sitting
  // unnoticed in the approval queue is the one failure this feature must not
  // have — it used to go straight to the kitchen — so the queue is worth a
  // connection of its own, unlike Recent (see ARCHITECTURE §7).
  useOrderStream(token, {
    onEvent: (name) => {
      if (name === 'qr_order_pending') loadPending();
    },
    onReconnect: () => {
      loadPending();
      loadFloor();
    },
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    staffApi
      .listItems(token)
      .then((data) => {
        if (!cancelled) setItems(data.items.filter((i) => i.is_available));
      })
      .catch((err) => {
        if (cancelled) return;
        if (!(err instanceof StaffApiError)) throw err;
        setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const selectTable = (tableId) => {
    setSelectedTableId(tableId);
    setCart([]);
  };

  const addItem = (item) => {
    setCart((lines) => {
      const existing = lines.find((l) => l.menu_item_id === item.id);
      if (existing) {
        return lines.map((l) => (l.menu_item_id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...lines, { menu_item_id: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  // quantity 0 removes the line.
  const setQuantity = (menuItemId, quantity) => {
    setCart((lines) =>
      quantity <= 0
        ? lines.filter((l) => l.menu_item_id !== menuItemId)
        : lines.map((l) => (l.menu_item_id === menuItemId ? { ...l, quantity } : l)),
    );
  };

  const subtotal = cart.reduce((sum, l) => sum + Number(l.price) * l.quantity, 0);

  const sendToKitchen = async () => {
    if (!selectedTableId || cart.length === 0) return false;
    setPlacing(true);
    setError(null);
    try {
      await staffApi.placeStaffOrder(token, {
        table_id: selectedTableId,
        items: cart.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity })),
      });
      setCart([]);
      await loadFloor(); // the table now shows occupied
      return true;
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
      return false;
    } finally {
      setPlacing(false);
    }
  };

  // Open the checkout: fetch what the table actually owes, so Confirm is
  // always agreeing to an itemised bill rather than a number on a button.
  const openBill = async (tableId) => {
    setError(null);
    try {
      setBill(await staffApi.getTableBill(token, tableId));
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  };
  const closeBill = () => setBill(null);

  // Settling a table records HOW it was paid (cash/card/UPI at the counter) and
  // marks its orders paid, which frees it on the floor. No money moves here —
  // see ARCHITECTURE.md §2 and server/src/services/tables.js.
  //
  // The idempotency key is generated once per opened bill, not per tap, so a
  // double-tapped Confirm is the same request twice rather than two payments.
  // Returns a receipt on success, rather than closing the bill itself: the
  // dialog stays open to confirm what was taken, and the cashier dismisses it.
  // Closing on success would flash the amount away exactly when someone wants
  // to read it back to the customer.
  const checkoutTable = async (tableId, { method, idempotencyKey }) => {
    setCheckingOut(tableId);
    setError(null);
    try {
      const result = await staffApi.checkoutTable(token, tableId, { method, idempotencyKey });
      await loadFloor();
      if (selectedTableId === tableId) setSelectedTableId(null);
      return { ...result, method, paid_at: new Date().toISOString() };
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
      return null;
    } finally {
      setCheckingOut(null);
    }
  };

  // Approve hands the order to the kitchen; reject cancels it. Both then
  // refresh the queue and the floor, since either changes what a table owes.
  const decide = async (orderId, apiCall) => {
    setDeciding(orderId);
    setError(null);
    try {
      await apiCall(token, orderId);
      await Promise.all([loadPending(), loadFloor()]);
      return true;
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
      await loadPending(); // a 409 means someone else got there first — resync
      return false;
    } finally {
      setDeciding(null);
    }
  };

  return {
    tables,
    items,
    selectedTableId,
    selectTable,
    cart,
    addItem,
    setQuantity,
    subtotal,
    placing,
    checkingOut,
    pending,
    deciding,
    approveOrder: (orderId) => decide(orderId, staffApi.approveOrder),
    rejectOrder: (orderId) => decide(orderId, staffApi.rejectOrder),
    bill,
    openBill,
    closeBill,
    checkoutTable,
    error,
    dismissError: () => setError(null),
    sendToKitchen,
  };
}
