import { useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';

// One order's full detail + status timeline (GET /orders/:id), for the
// detail drawer. Re-fetches whenever a different order is opened; null
// orderId means the drawer is closed, and fetches nothing.
export function useOrderDetail(token, orderId) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setOrder(null);
    setError(null);
    staffApi
      .orderDetail(token, orderId)
      .then(({ order: detail }) => {
        if (!cancelled) setOrder(detail);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!(err instanceof StaffApiError)) throw err;
        setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, orderId]);

  return { order, error };
}
