import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// One .env for the whole repo, at its root (scripts/db.sh reads the same file).
const ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL'];

export function loadConfig(env = process.env) {
  dotenv.config({ path: ENV_PATH, quiet: true });

  const missing = REQUIRED.filter((name) => !env[name] || env[name].includes('YOUR_'));
  if (missing.length) {
    throw new Error(
      `Missing or placeholder values in .env: ${missing.join(', ')}. ` +
        'Copy .env.example to .env at the repo root and fill them in.',
    );
  }

  return {
    port: Number(env.PORT) || 4000,
    supabaseUrl: env.SUPABASE_URL.trim(),
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY.trim(),
    databaseUrl: env.DATABASE_URL.trim(),
    databaseCaCert: env.DATABASE_CA_CERT?.trim() || null,
    // The customer web app. Also the only origin allowed through CORS.
    appBaseUrl: (env.APP_BASE_URL || 'http://localhost:5173').trim().replace(/\/$/, ''),
    guestSessionTtlHours: 3,
    // Caddy (on this machine) is the only proxy Express believes about client
    // addresses. Cloudflare's addresses are handled in the Caddyfile, not here.
    // Who the invoices to cafés are from. Printed on every invoice and copied onto it when
    // it is recorded, so changing these never rewrites an invoice already sent.
    billingSeller: {
      name: env.BILLING_SELLER_NAME?.trim() || 'BurpnBill',
      address: env.BILLING_SELLER_ADDRESS?.trim() || null,
      phone: env.BILLING_SELLER_PHONE?.trim() || null,
      email: env.BILLING_SELLER_EMAIL?.trim() || null,
      tax_id: env.BILLING_SELLER_TAX_ID?.trim() || null,
    },
    trustProxy: env.TRUST_PROXY?.trim() || 'loopback',
    // Per-client limits on the public routes; see middleware/rateLimit.js for
    // what each number means. RATE_LIMIT=off switches them all off.
    rateLimit: env.RATE_LIMIT?.trim() === 'off' ? undefined : {},
  };
}
