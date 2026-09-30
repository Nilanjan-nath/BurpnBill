import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createSupabaseAdmin } from './supabase.js';
import { createOrderEventHub } from './orderStream.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = createDb(config.databaseUrl, { caCertPath: config.databaseCaCert });
const supabase = createSupabaseAdmin(config);
const hub = createOrderEventHub();

const checks = {
  database: () => db.ping(),
  supabase: async () => {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/health`, {
      headers: { apikey: config.supabaseServiceRoleKey },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`auth health returned HTTP ${res.status}`);
  },
};

const app = createApp({ config, db, supabase, checks, hub });

const server = app.listen(config.port, () => {
  console.log(`BurpnBill API listening on http://localhost:${config.port}`);
});

// Close every open SSE stream FIRST — one never "completes" on its own, and
// server.close() would otherwise wait forever for connections that are
// never going to end by themselves. Only then stop taking new connections
// and release the database pool.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  hub.closeAll();
  server.close(() => db.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
