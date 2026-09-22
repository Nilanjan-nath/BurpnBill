import express from 'express';
import cors from 'cors';
import { errorHandler, notFoundHandler } from './errors.js';
import { createRequireStaff } from './middleware/auth.js';
import { createRequireGuestSession, GUEST_SESSION_HEADER } from './middleware/guestSession.js';
import { publicRoutes } from './routes/public.js';
import { staffRoutes } from './routes/staff.js';

// Builds the Express app from its dependencies, so tests can pass fakes.
//   checks: { name: async () => void } — run by GET /health/ready
export function createApp({ config, db, supabase, checks = {} }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: config.appBaseUrl,
      allowedHeaders: ['Content-Type', 'Authorization', GUEST_SESSION_HEADER],
    }),
  );
  app.use(express.json({ limit: '16kb' }));

  // Liveness: the process is up.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Readiness: the database and Supabase Auth are reachable with our credentials.
  app.get('/health/ready', async (req, res) => {
    const results = {};
    await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await check();
          results[name] = 'ok';
        } catch (err) {
          results[name] = `error: ${err.message}`;
        }
      }),
    );
    const ok = Object.values(results).every((r) => r === 'ok');
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', checks: results });
  });

  const requireStaff = createRequireStaff({ supabase, db });
  const requireGuestSession = createRequireGuestSession({ db, sessionTtlHours: config.guestSessionTtlHours });

  app.use('/api', publicRoutes({ db, config, requireGuestSession }));
  app.use('/api', staffRoutes({ db, requireStaff }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
