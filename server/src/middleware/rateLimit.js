import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { HttpError } from '../errors.js';
import { GUEST_SESSION_HEADER } from './guestSession.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const passthrough = (req, res, next) => next();

// Defaults are deliberately generous: a whole cafe shares one Wi-Fi address, and
// every phone polls /orders/status every 15s, so 40 diners is ~160 requests a
// minute from ONE ip. Loosen before tightening — a blocked customer is worse
// than a noisy one. Each value can be overridden in config.rateLimit.
export const DEFAULT_RATE_LIMITS = {
  // Flood backstop per ip across every public route. Sized so a full cafe never reaches it.
  ipPerMinute: 1000,
  menuPerMinute: 120,
  receiptsPerMinute: 30,
  createCafePerHour: 5,
  // Per guest session, so two diners behind one ip never share a bucket.
  orderPerMinute: 10,
  statusPerMinute: 20,
  cartPerMinute: 60,
  // The platform admin area: one person, so this only has to stop a guessing script.
  adminPerMinute: 120,
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Builds the limiters once, from config.rateLimit.
//   config.rateLimit absent -> every limiter is a no-op (the test suites for
//   other features run this way, so none of them can trip over a limit)
//
// The key is the client ip (req.ip, which is only the real client once Express
// trusts the proxy in front of it — see `trust proxy` in app.js) or, for the
// per-session limiters, the guest session id.
export function createRateLimiters(settings) {
  if (!settings) {
    return {
      perIp: passthrough,
      menu: passthrough,
      receipts: passthrough,
      createCafe: passthrough,
      order: passthrough,
      status: passthrough,
      cart: passthrough,
      admin: passthrough,
    };
  }
  const s = { ...DEFAULT_RATE_LIMITS, ...settings };

  const handler = (req, res, next) => {
    // Someone is being blocked: worth a line in the journal, with who.
    console.warn(`[rate-limit] ${req.method} ${req.originalUrl} from ${req.ip}`);
    next(new HttpError(429, 'rate_limited', 'Too many requests. Please wait a few seconds and try again.'));
  };

  const make = (windowMs, limit, keyGenerator) =>
    rateLimit({
      windowMs,
      limit,
      handler,
      standardHeaders: 'draft-7', // RateLimit + Retry-After headers
      legacyHeaders: false,
      keyGenerator,
    });

  const byIp = (req) => ipKeyGenerator(req.ip);
  // A session id only counts if it is the right shape; anything else falls back
  // to the ip, so a made-up header cannot be used to dodge the limit (the
  // per-ip backstop catches random ids anyway). Runs BEFORE requireGuestSession
  // on purpose: a rejected request should not spend a database query.
  const bySession = (req) => {
    const id = req.get(GUEST_SESSION_HEADER);
    return id && UUID.test(id) ? `session:${id.toLowerCase()}` : byIp(req);
  };

  return {
    perIp: make(MINUTE, s.ipPerMinute, byIp),
    menu: make(MINUTE, s.menuPerMinute, byIp),
    receipts: make(MINUTE, s.receiptsPerMinute, byIp),
    createCafe: make(HOUR, s.createCafePerHour, byIp),
    order: make(MINUTE, s.orderPerMinute, bySession),
    status: make(MINUTE, s.statusPerMinute, bySession),
    cart: make(MINUTE, s.cartPerMinute, bySession),
    admin: make(MINUTE, s.adminPerMinute, byIp),
  };
}
