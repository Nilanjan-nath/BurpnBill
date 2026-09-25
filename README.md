# Petuk

*পেটুক — Bengali for one who loves their food.*

Customers scan a QR code at their table, browse the live menu, and place an order
that lands instantly on the kitchen/reception dashboard.

Status: **step 6 of 7 in progress** — owners can manage the menu and tables, and now run a
POS: pick a table off a live floor map, build a walk-in's order from the real menu, send it
to the kitchen exactly like a QR order would. A today's-snapshot dashboard and staff
invite/role management are what's left before the landing page.
Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · what's left: [docs/TASKS.md](docs/TASKS.md)

## v1 scope

Customers scan, browse, and order. Staff manage the menu and work a live order
board. Payment happens at the counter, outside the app.

**Payments are modelled but not built in v1.** The `payments` table, its unique
`idempotency_key`, the one-successful-payment-per-order index and the `paid_at`
sync trigger all ship in the schema and are covered by the invariant checks — no
endpoint writes to them yet. Turning payments on later is new code against an
existing model, not a migration.

Also out of v1: invoices, customer login, customer-facing order tracking, stock
counts, structured modifiers (free-text notes only).

## Layout

```
server/                                Express API (Node 22+)
  src/index.js                         entry point: config, db pool, listen
  src/app.js                           middleware, health checks, route mounting
  src/routes/public.js                 customer routes (guest session)
  src/routes/staff.js                  staff/owner routes (Supabase Auth)
  test/                                node:test suite, no database needed
web/                                   customer web app (React + Vite)
  src/useOrdering.js                   menu, cart, order state and every recovery case
  src/components/                      menu, item sheet, cart, confirmation screens
  src/App.test.jsx                     UI tests: real app -> real API -> real Postgres (PGlite)
supabase/
  migrations/20260919090000_init.sql   full schema: tables, enums, triggers, indexes, RLS
  migrations/20260921120000_one_order_per_cart.sql   one order per cart, enforced by an index
  seed.sql                             demo cafe, 4 tables, 12 menu items (re-runnable)
scripts/
  verify_schema.sql                    11 invariant checks; runs in a transaction, rolls back
docs/
  ARCHITECTURE.md                      what v1 is, API, decisions
  TASKS.md                             pending work, by build step
  schema.md                            entity map and the decisions baked into the schema
```

## Quick start

With a filled-in `.env` at the repo root:

```bash
npm run setup   # once: installs server/ and web/ dependencies
npm run dev     # starts the API (:4000) and the customer app (:5173) together
npm test        # all tests, no database or network needed
```

Open `http://localhost:5173/t/<qr_token>` (`scripts/db.sh seed` prints the demo tokens). The
servers only run while `npm run dev` is running — if the app says it "can't reach the server",
that is the first thing to check.

## Running the API

Needs Node 22+ and a filled-in `.env` at the repo root (see below).

```bash
cd server
npm install
npm run dev     # http://localhost:4000, restarts on file changes
npm test        # no database needed
```

`GET /health/ready` confirms the database and Supabase Auth are reachable with your
credentials. Routes for later build steps answer `501` with the step they arrive in.

## Running the customer app

Start the API first (above), then in a second terminal:

```bash
cd web
npm install
npm run dev     # http://localhost:5173 — `/api` is proxied to the API on :4000
npm test        # no database or API needed: the tests start their own
```

Open `http://localhost:5173/t/<qr_token>` (`scripts/db.sh seed` prints the demo tokens).
The dev server also prints a **Network** URL, so you can open the same page on a phone on
your Wi-Fi. When the API is hosted on a different domain, build with `VITE_API_URL` set to
its address, e.g. `VITE_API_URL=https://api.example.com npm run build`.

## Running the staff dashboard

Same dev server as the customer app, at `/staff` — it's lazy-loaded, so it costs customers
nothing. It needs its own Supabase login, separate from the server's `.env`:

```bash
cp web/.env.example web/.env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
```

Use the **same** URL and anon key as the server's `.env` — never the service-role key, which
must never reach a browser build. Then open `http://localhost:5173/staff` and sign in with a
Supabase login linked in `staff_members` (see **Setting up Supabase**, step 4, below).

## Setting up Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) (free tier is fine).
   Pick a region close to your users and save the database password.
2. Copy `.env.example` to `.env` and fill in the values from
   **Project Settings → API** and **Project Settings → Database**.
3. Apply the schema, seed it, and check it:
   ```bash
   scripts/db.sh migrate   # every migration under supabase/migrations/, in order
   scripts/db.sh seed      # demo cafe + menu; prints your QR tokens
   scripts/db.sh verify    # 11 invariant checks; rolls back, changes nothing
   scripts/db.sh status    # which migrations have been applied
   ```
   Anything under `supabase/migrations/` is recorded in `public.schema_migrations`
   and applied at most once, so re-running `init` is a no-op rather than a wall of
   "already exists" errors. `seed` and `verify` are safe to run repeatedly by design.
   `db.sh` reads `DATABASE_URL` out of `.env`. Use the **Session pooler** connection
   string from the dashboard — the direct one is IPv6-only and fails on most home
   networks. If your database password contains `@ : / ? # [ ] %`, percent-encode it.

   Doing it by hand instead — any one of:

   **Dashboard (no tooling):** SQL Editor → New query → paste
   `supabase/migrations/20260919090000_init.sql` → Run. Then do the same with `supabase/seed.sql`.

   **psql:**
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919090000_init.sql
   ```

   **Supabase CLI:**
   ```bash
   npm i -g supabase && supabase link --project-ref <project-ref> && supabase db push
   ```
4. Create your staff login under **Authentication → Users → Add user**, then link it:
   ```sql
   insert into public.staff_members (user_id, restaurant_id, role)
   values ('<auth user id>', '11111111-1111-1111-1111-111111111111', 'owner');
   ```

## Build order

1. ~~Database schema~~ — done
2. ~~Express scaffolding: Supabase client wiring, route stubs~~ — done
3. ~~Public flow end to end: QR scan -> guest session -> menu -> cart -> order~~ — done
4. ~~SSE stream + live staff dashboard~~ — done: orders API, live push, sign-in, the board
   going live, an order-detail view and a Recent tab (see `docs/TASKS.md`)
5. ~~Owner admin panel: menu CRUD + availability toggle, tables + printable QR codes~~ — done
6. Owner operations dashboard: floor map + staff-placed POS orders done; today's-snapshot
   dashboard and staff invite/role management still to come (see `docs/TASKS.md` step 6)
7. Landing page — last

Deferred past v1: payments (`POST /payments` against the existing model), invoices,
RLS policies, Redis pub/sub for multi-instance SSE, customer-facing order status.
Full list: [docs/TASKS.md](docs/TASKS.md).
