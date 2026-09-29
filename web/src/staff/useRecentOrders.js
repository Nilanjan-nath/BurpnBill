import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// Served/cancelled orders (GET /orders/recent) for the Recent tab, one café
// day at a time. Unlike the live board, this doesn't listen to the SSE stream
// — a manual Refresh is enough for "what happened earlier", and it avoids a
// second stream connection per staff session for a screen nobody watches
// continuously.
//
// Switching day refetches rather than filtering a bigger download in the
// browser: the window is the server's own question (it knows where the café's
// midnight falls) and yesterday is usually never opened at all.
export function useRecentOrders(token, day = 'today') {
  const [orders, setOrders] = useState(null); // null = still loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await staffApi.recentOrders(token, { day });
      setOrders(data.orders);
      setError(null);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token, day]);

  useEffect(() => {
    // Clear the previous day's rows before the new day's arrive, or the screen
    // shows yesterday's orders under a "Today" heading for one render.
    setOrders(null);
    load();
  }, [load]);

  return { orders, error, refresh: load };
}
