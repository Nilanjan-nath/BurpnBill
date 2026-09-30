import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api.js';

// Keeps a screen's view of "where is my food" fresh — by asking, not by being
// told. The phone polls GET /orders/status; there is no live connection to a
// customer (see docs/ARCHITECTURE.md for why). The rules exist to keep that
// cheap on a small free-tier database and to never be the reason a phone's
// battery or a café's connection pool runs out:
//
//   - it only exists while a screen that shows status is mounted, so nothing
//     polls before an order has been placed or after the customer has left
//   - every 15s at first, every 30s once it has been going for five minutes
//   - paused while the tab is hidden, and checked at once on coming back
//   - stops for good when every order is served or cancelled, or when there are
//     none — and starts again if the customer presses Refresh
export const FAST_MS = 15_000;
export const SLOW_MS = 30_000;
export const SLOW_AFTER_MS = 5 * 60_000;

const FINISHED = new Set(['served', 'cancelled']);
const allFinished = (status) => status.orders.every((o) => FINISHED.has(o.stage));

export function useOrderStatus(fetchStatus) {
  const [status, setStatus] = useState(null);
  const [failed, setFailed] = useState(false); // last check didn't reach the server
  const [checking, setChecking] = useState(false);
  const [restarts, setRestarts] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const startedAt = Date.now();

    // Resolves to whether polling should carry on.
    const check = async () => {
      setChecking(true);
      try {
        const latest = await fetchStatus();
        if (cancelled) return false;
        setStatus(latest);
        setFailed(false);
        return !allFinished(latest);
      } catch (err) {
        if (cancelled) return false;
        // An expired session can't be fixed by asking again; the bill screen
        // is what walks someone back through scanning. Keep what was showing.
        if (err instanceof ApiError && err.isSessionProblem) return false;
        setFailed(true); // keep the last good answer on screen and try again
        return true;
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    const schedule = () => {
      clearTimeout(timer);
      const wait = Date.now() - startedAt > SLOW_AFTER_MS ? SLOW_MS : FAST_MS;
      timer = setTimeout(tick, wait);
    };

    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) return schedule(); // paused; coming back triggers a check
      if (await check()) schedule();
    };

    const onVisible = () => {
      if (document.hidden || cancelled) return;
      clearTimeout(timer);
      tick();
    };

    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchStatus, restarts]);

  // Ask once now, and — if polling had stopped because everything was finished —
  // start it again, since a Refresh is someone saying they still care.
  const refresh = useCallback(() => setRestarts((n) => n + 1), []);

  return { status, failed, checking, refresh };
}
