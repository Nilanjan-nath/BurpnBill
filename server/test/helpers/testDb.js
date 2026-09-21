import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { types } from '@electric-sql/pglite';

// A real Postgres, in-process (PGlite = Postgres compiled to WASM), with the
// repo's actual migrations and seed applied. No install, no network, and it
// never touches the Supabase project. Each call returns a fresh database.
//
// The returned object has the same shape as createDb() in src/db.js, so the
// services and routes run unchanged.

const SUPABASE_DIR = fileURLToPath(new URL('../../../supabase/', import.meta.url));

// Match node-postgres: int8 (order_number) as a JS number, numeric as a string.
const parsers = { [types.INT8]: (v) => Number(v) };

export const RESTAURANT_ID = '11111111-1111-1111-1111-111111111111';

export async function createTestDb() {
  const pg = new PGlite({ parsers });

  const migrations = readdirSync(`${SUPABASE_DIR}migrations`).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) await pg.exec(readFileSync(`${SUPABASE_DIR}migrations/${file}`, 'utf8'));
  await pg.exec(readFileSync(`${SUPABASE_DIR}seed.sql`, 'utf8'));

  return {
    pg,
    query: (text, params) => pg.query(text, params),

    async withTransaction(fn, { actorId } = {}) {
      return pg.transaction(async (tx) => {
        if (actorId) await tx.query("select set_config('app.actor_id', $1, true)", [actorId]);
        return fn(tx);
      });
    },

    ping: () => pg.query('select 1'),
    close: () => pg.close(),
  };
}
