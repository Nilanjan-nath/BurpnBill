# Petuk

*পেটুক — Bengali for one who loves their food.*

Customers scan a QR code at their table, browse the live menu, and place an order
that lands instantly on the kitchen/reception dashboard.

Status: **step 2 of 6 done — API scaffolding.** Next: the public ordering flow.
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
supabase/
  migrations/20260919090000_init.sql   full schema: tables, enums, triggers, indexes, RLS
  seed.sql                             demo cafe, 4 tables, 12 menu items (re-runnable)
scripts/
  verify_schema.sql                    11 invariant checks; runs in a transaction, rolls back
docs/
  ARCHITECTURE.md                      what v1 is, API, decisions
  TASKS.md                             pending work, by build step
  schema.md                            entity map and the decisions baked into the schema
```

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

## Setting up Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) (free tier is fine).
   Pick a region close to your users and save the database password.
2. Copy `.env.example` to `.env` and fill in the values from
   **Project Settings → API** and **Project Settings → Database**.
3. Apply the schema, seed it, and check it:
   ```bash
   scripts/db.sh init      # the migration
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
3. Public flow end to end: QR scan -> guest session -> menu -> cart -> order
4. SSE stream + live staff dashboard
5. Owner admin panel: menu CRUD + availability toggle
6. Landing page

Deferred past v1: payments (`POST /payments` against the existing model), invoices,
RLS policies, Redis pub/sub for multi-instance SSE, customer-facing order status.
Full list: [docs/TASKS.md](docs/TASKS.md).
