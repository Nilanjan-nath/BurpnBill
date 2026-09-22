import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// The static board for slice 3: one GET /orders on mount, and a full
// refetch after any action succeeds. No live push yet — that's slice 4 —
// so a staff member pressing a button and immediately seeing it move,
// themselves, is enough for now.
export function useBoard(token) {
  const [orders, setOrders] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null); // which order a request is in flight for
  const [conflict, setConflict] = useState(null); // "already moved by X" style message

  const load = useCallback(async () => {
    if (!token) return; // not signed in / not confirmed as staff yet — see StaffApp's SignedIn
    try {
      const data = await staffApi.listOrders(token);
      setOrders(data.orders);
      setError(null);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const move = useCallback(
    async (order, status) => {
      setBusyId(order.id);
      setConflict(null);
      try {
        await staffApi.updateStatus(token, order.id, status);
        await load();
      } catch (err) {
        if (!(err instanceof StaffApiError)) throw err;
        if (err.status === 409) {
          // Someone else already moved it (or our view was just stale) —
          // say so, then resync so the board matches reality again.
          const { current_status: current, changed_by: by } = err.details;
          setConflict(
            by
              ? `#${order.order_number} was already moved to "${current}" by ${by}.`
              : `#${order.order_number} is already "${current}".`,
          );
          await load();
        } else {
          setConflict(err.message);
        }
      } finally {
        setBusyId(null);
      }
    },
    [token, load],
  );

  return { orders, error, busyId, conflict, move, refresh: load, dismissConflict: () => setConflict(null) };
}
