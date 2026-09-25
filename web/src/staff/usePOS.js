import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

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

  useEffect(() => {
    loadFloor();
  }, [loadFloor]);

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

  // A table stays occupied through "served" — see floor.js — so this is the
  // only way to free one today. No payments feature yet: it just marks that
  // table's served orders paid. A fuller bill/checkout screen is a follow-up.
  const checkoutTable = async (tableId) => {
    setCheckingOut(tableId);
    setError(null);
    try {
      await staffApi.checkoutTable(token, tableId);
      await loadFloor();
      if (selectedTableId === tableId) setSelectedTableId(null);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    } finally {
      setCheckingOut(null);
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
    checkoutTable,
    error,
    dismissError: () => setError(null),
    sendToKitchen,
  };
}
