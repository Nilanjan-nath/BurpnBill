import { createServer } from 'node:http';
import { createApp } from '../../../server/src/app.js';
import { createTestDb } from '../../../server/test/helpers/testDb.js';

// Starts the REAL Express API (from ../server) on a real Postgres (PGlite with
// the repo's migrations + seed) once for the whole run, so the UI tests
// exercise the actual contract rather than a hand-written fake of it.
//
// It runs in plain Node, outside the jsdom test environment, and hands the
// tests its address via `inject('apiBase')`. A test-only endpoint,
// POST /__test/sql, lets a test change the database the way staff or time
// would (86 an item, expire a session) and read it back.

export default async function setup({ provide }) {
  const db = await createTestDb();

  const api = createApp({
    config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 },
    db,
    supabase: {},
  });

  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/__test/sql') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try {
        const { text, params } = JSON.parse(raw);
        const { rows } = await db.query(text, params);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ rows }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    api(req, res);
  });

  await new Promise((resolve) => server.listen(0, resolve));
  provide('apiBase', `http://localhost:${server.address().port}`);

  return async () => {
    server.close();
    await db.close();
  };
}
