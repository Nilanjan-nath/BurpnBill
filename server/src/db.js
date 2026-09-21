import { readFileSync } from 'node:fs';
import pg from 'pg';

// Data access goes straight to Postgres, not through supabase-js/PostgREST:
// placing an order has to lock the cart, write the order and its lines, and
// mark the cart converted in one transaction, and PostgREST can't span
// requests with a transaction. supabase-js is kept for verifying staff logins.
//
// numeric columns (prices, totals) come back as strings on purpose — parsing
// them into JS floats is how 0.1 + 0.2 ends up on a bill.

// Always encrypted. Supabase signs its database certificate with its own CA,
// so full verification needs that CA's file (DATABASE_CA_CERT); without it the
// connection is encrypted but the server's identity is not checked.
function sslOptions(caCertPath) {
  if (!caCertPath) return { rejectUnauthorized: false };
  return { rejectUnauthorized: true, ca: readFileSync(caCertPath, 'utf8') };
}

// bigint (order_number) as a JS number, like the test database does. Safe: order
// numbers count orders, nowhere near 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export function createDb(databaseUrl, { caCertPath } = {}) {
  if (!caCertPath) {
    console.warn('[db] DATABASE_CA_CERT not set: connection is encrypted but the server certificate is not verified');
  }
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: sslOptions(caCertPath),
    // The Supabase session pooler caps clients per project (15 on the free
    // tier), and scripts/db.sh or the dashboard may be holding some.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));

  return {
    query: (text, params) => pool.query(text, params),

    // Runs fn(client) inside BEGIN/COMMIT, rolling back if it throws.
    // actorId is the staff user making the change: order_status_events.changed_by
    // is filled from it by the log_order_status_event trigger.
    async withTransaction(fn, { actorId } = {}) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        if (actorId) {
          await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
        }
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async ping() {
      await pool.query('select 1');
    },

    close: () => pool.end(),
  };
}
