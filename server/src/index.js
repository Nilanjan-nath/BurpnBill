import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createSupabaseAdmin } from './supabase.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = createDb(config.databaseUrl, { caCertPath: config.databaseCaCert });
const supabase = createSupabaseAdmin(config);

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

const app = createApp({ config, db, supabase, checks });

const server = app.listen(config.port, () => {
  console.log(`Petuk API listening on http://localhost:${config.port}`);
});

// Stop taking connections, then release the database pool.
// SSE connections (step 4) are long-lived and will need closing here too.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => db.close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
