import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// Served/cancelled orders (GET /orders/recent) for the Recent tab. Unlike
// the live board, this doesn't listen to the SSE stream — a manual Refresh
// is enough for "what happened a while ago", and it avoids a second stream
// connection per staff session for a screen nobody watches continuously.
export function useRecentOrders(token, hours) {
  const [orders, setOrders] = useState(null); // null = still loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await staffApi.recentOrders(token, hours);
      setOrders(data.orders);
      setError(null);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token, hours]);

  useEffect(() => {
    load();
  }, [load]);

  return { orders, error, refresh: load };
}
