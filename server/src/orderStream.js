// A tiny in-memory pub/sub for pushing order updates to open staff dashboards
// over Server-Sent Events. One process, one hub: every café's connected staff
// dashboards sit in a Set, keyed by restaurant_id. Publishing writes an SSE
// frame to each of them.
//
// Nothing is persisted or replayed — there's no event log, no catch-up. A
// dashboard that reconnects after a drop just calls GET /orders again to
// resync, which is simpler and, for a handful of connections per café, no
// slower than trying to replay what it missed.
//
// Deliberately not built for more than one backend process — scaling past
// that needs a shared layer (e.g. Redis), a known and documented limitation.
export function createOrderEventHub({ heartbeatMs = 25_000 } = {}) {
  const byRestaurant = new Map(); // restaurant_id -> Set<ServerResponse>

  function write(res, chunk, connections) {
    try {
      res.write(chunk);
    } catch {
      // A write to a half-dead socket can throw synchronously; treat it the
      // same as a clean disconnect rather than letting it break the loop for
      // every other subscriber.
      connections.delete(res);
    }
  }

  // A comment line (a frame starting with ":") is invisible to SSE parsers —
  // it exists purely to keep the connection active through proxies and load
  // balancers that drop a stream once it looks idle.
  const heartbeat = setInterval(() => {
    for (const [restaurantId, connections] of byRestaurant) {
      for (const res of connections) write(res, ': ping\n\n', connections);
      if (connections.size === 0) byRestaurant.delete(restaurantId);
    }
  }, heartbeatMs);
  heartbeat.unref(); // must never be the reason the process (or a test run) stays alive

  function subscribe(restaurantId, res) {
    let connections = byRestaurant.get(restaurantId);
    if (!connections) byRestaurant.set(restaurantId, (connections = new Set()));
    connections.add(res);

    const unsubscribe = () => {
      connections.delete(res);
      if (connections.size === 0) byRestaurant.delete(restaurantId);
    };
    res.on('close', unsubscribe); // covers a closed tab, a dropped connection, a locked phone
    return unsubscribe;
  }

  function publish(restaurantId, event, data) {
    const connections = byRestaurant.get(restaurantId);
    if (!connections || connections.size === 0) return; // nobody's dashboard is open — nothing to do
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of connections) write(res, frame, connections);
  }

  // Ends every open stream so the HTTP server can actually finish shutting
  // down. Left alone, an SSE response never "completes" on its own, and
  // server.close() would wait for it forever.
  function closeAll() {
    clearInterval(heartbeat);
    for (const connections of byRestaurant.values()) {
      for (const res of connections) res.end();
    }
    byRestaurant.clear();
  }

  // How many dashboards are open for one café right now. Not used by any
  // route — for tests, and for a future "N staff connected" diagnostic.
  function connectionCount(restaurantId) {
    return byRestaurant.get(restaurantId)?.size ?? 0;
  }

  return { subscribe, publish, closeAll, connectionCount };
}
