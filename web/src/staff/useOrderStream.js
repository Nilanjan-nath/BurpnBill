import { useEffect, useRef, useState } from 'react';
import { readEventStream } from './sse.js';

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;
const MAX_BACKOFF_MS = 15_000;

// Keeps one connection to GET /orders/stream open for as long as this hook
// is mounted, reconnecting with exponential backoff if it drops — and it
// will drop, on a kitchen tablet's Wi-Fi, so this never fails silently: the
// caller always knows whether it's live or trying to recover (see `status`).
//
// Not the browser's EventSource — it can't send an Authorization header, and
// this stream needs the same staff token as every other request (see
// server/src/routes/staff.js). fetch() + a hand-rolled reader (sse.js) does
// instead.
//
//   onEvent(name, data)  — called for every pushed order
//   onReconnect()        — called after a drop recovers, NOT on the first
//                          connect (the board's own initial GET /orders
//                          already covers that) — a gap may have missed
//                          events, so the caller should refetch to resync
export function useOrderStream(token, { onEvent, onReconnect }) {
  const [status, setStatus] = useState('connecting'); // 'connecting' | 'live' | 'reconnecting'
  const onEventRef = useRef(onEvent);
  const onReconnectRef = useRef(onReconnect);
  onEventRef.current = onEvent;
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    let stopped = false;
    let everConnected = false;
    let attempt = 0;

    async function connectLoop() {
      while (!stopped) {
        setStatus(everConnected ? 'reconnecting' : 'connecting');
        try {
          const res = await fetch(`${BASE}/orders/stream`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`stream returned HTTP ${res.status}`);

          attempt = 0; // a successful connection resets the backoff
          if (everConnected) onReconnectRef.current?.();
          everConnected = true;
          setStatus('live');

          await readEventStream(res, (event, data) => onEventRef.current?.(event, data));
          // Resolves when the stream ends (dropped, or the server closed it
          // on shutdown) — fall through below to back off and reconnect.
        } catch {
          if (controller.signal.aborted) return; // unmounting, not a real failure
        }
        if (stopped || controller.signal.aborted) return;
        const wait = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }

    connectLoop();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [token]);

  return status;
}
