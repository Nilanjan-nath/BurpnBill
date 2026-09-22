import { useCallback, useEffect, useRef, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';
import { useOrderStream } from './useOrderStream.js';
import { skewFromServerTime } from './age.js';

const ACTIVE = new Set(['placed', 'preparing', 'ready']);
const byOrderNumber = (a, b) => a.order_number - b.order_number;

// Upserts (or removes, once it's left the active board) one pushed order
// into the current list. Used for BOTH order_created and
// order_status_changed — the difference between them only matters for
// whether it should also count as a "new" order (see useBoard below).
function applyBoardEvent(orders, order) {
  const rest = orders.filter((o) => o.id !== order.id);
  return ACTIVE.has(order.status) ? [...rest, order].sort(byOrderNumber) : rest;
}

// The live board: one GET /orders on mount, kept in sync after that by the
// SSE stream from server/src/orderStream.js rather than by polling — a
// pushed order is patched straight into the list, not waited for on a
// refetch. A full refetch happens only: after an action THIS tab took (the
// simplest way to be sure of the result), and after the stream drops and
// reconnects (a gap may have missed events — see useOrderStream.js).
export function useBoard(token) {
  const [orders, setOrders] = useState(null); // null = still loading
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null); // which order a request is in flight for
  const [conflict, setConflict] = useState(null); // "already moved by X" style message
  const [newOrderCount, setNewOrderCount] = useState(0); // order_created events since last look — see useNewOrderAlerts
  const skewRef = useRef(0); // device clock vs server clock, see age.js

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await staffApi.listOrders(token);
      skewRef.current = skewFromServerTime(data.server_time);
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

  const onStreamEvent = useCallback((event, order) => {
    setOrders((current) => (current === null ? current : applyBoardEvent(current, order)));
    if (event === 'order_created') setNewOrderCount((n) => n + 1);
  }, []);

  const liveStatus = useOrderStream(token, { onEvent: onStreamEvent, onReconnect: load });

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

  return {
    orders,
    error,
    busyId,
    conflict,
    liveStatus,
    newOrderCount,
    skewMs: skewRef.current,
    move,
    refresh: load,
    dismissConflict: () => setConflict(null),
    acknowledgeNewOrders: () => setNewOrderCount(0),
  };
}
