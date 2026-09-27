import { useCallback, useEffect, useState } from 'react';
import { staffApi, StaffApiError } from './staffApi.js';
import { useOrderStream } from './useOrderStream.js';

// Today's numbers. Refetched rather than patched: these are aggregates, and
// recomputing one from a pushed event would mean re-implementing the SQL in
// the browser and getting to be subtly wrong. The screen is cheap to reload
// and only the owner is looking at it.
export function useDashboard(token) {
  const [summary, setSummary] = useState(null); // null = still loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      // The browser's own zone, so "today" is the café's day rather than
      // UTC's — which rolls over at 05:30 in India, mid-morning-shift.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setSummary(await staffApi.getDashboardSummary(token, tz));
      setError(null);
    } catch (err) {
      if (!(err instanceof StaffApiError)) throw err;
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Anything that moves an order moves at least one number here.
  useOrderStream(token, { onEvent: load, onReconnect: load });

  return { summary, error, refresh: load };
}
