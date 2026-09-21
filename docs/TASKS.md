# Pending tasks

What's left for v1, in build order. Scope and decisions: [ARCHITECTURE.md](ARCHITECTURE.md).
Tick items off as they land.

## Housekeeping (do soon)

- [ ] **Link your staff login.** `staff_members` is empty, so every staff route returns 403.
      Create the user in Supabase → Authentication → Users, then:
      `insert into public.staff_members (user_id, restaurant_id, role) values ('<auth user id>', '11111111-1111-1111-1111-111111111111', 'owner');`
- [ ] **Verify the database certificate.** Download Supabase's CA certificate
      (Project Settings → Database → SSL Configuration) and set `DATABASE_CA_CERT` in `.env`.
      Until then the API's database connection is encrypted but not verified.
- [ ] Once the API verifies the certificate, turn on **Enforce SSL** in the same dashboard section.
- [ ] Add a `.gitattributes` with `*.sh text eol=lf`. On Windows, Git otherwise checks out
      `scripts/db.sh` with CRLF line endings and bash refuses to run it.
- [ ] `.gitignore` lists `docs/schema.md`, `scripts/db.sh`, `scripts/verify_schema.sql`, the
      migration and `seed.sql`. Git still tracks them, but a new file at those paths would be
      silently ignored — remove those lines.
- [ ] `scripts/db.sh` checks for the placeholder `YOUR-PASSWORD`, but `.env.example` uses
      `YOUR_PASSWORD`, so an unfilled `.env` gives a DNS error instead of the helpful message.

## Step 3 — Public flow end to end

**Database**
- [x] Migration: `unique (cart_id)` on `orders` (where not null), so one cart can never become
      two orders even if two requests race.

**API**
- [x] Pick a request validation library (e.g. zod) and validate every body and path param.
- [x] `GET /menu/:qrToken`
  - unknown token → 404; inactive table or restaurant → 403 `ordering_unavailable`
  - reuse the client's `X-Guest-Session` only if it is live **and** for this table; otherwise
    create a new session
  - return the restaurant, the table label, the session id + expiry, and available,
    non-deleted items grouped by category (uses `menu_items_public_read_idx`)
- [x] `GET /cart` — lines with current name/price and a server-computed subtotal
- [x] `POST /cart/items`
  - item must belong to the session's restaurant, be available and not deleted
    (cart_items has no `restaurant_id`, so this check is the only guard)
  - quantity 1–99; notes trimmed, empty → null, ≤ 280 chars
  - same item + same notes → merge into the existing line
- [x] `PATCH /cart/items/:cartItemId`, `DELETE /cart/items/:cartItemId` — only lines in the
      session's own open cart
- [x] `POST /orders` with `{ cart_id }` (the id `GET /cart` returned), in one transaction:
  - lock that cart (`for update`); it must belong to the session
  - cart already converted → return the order made from it (200) — this is the
    retry/double-tap case, and naming the cart means a retry can never be mistaken for a
    new order
  - empty cart → 400
  - any line unavailable or deleted → 409 listing those lines; nothing is written
  - copy current price and name onto each `order_items` row; compute subtotal/total on the
    server (the client never sends prices)
  - mark the cart `converted`; return the new order (201) with its `order_number`
- [x] Tests for the whole flow run against a real Postgres: PGlite (Postgres in-process, no
      install) with the repo's real migrations and seed. Also checked once by hand against
      Supabase inside a rolled-back transaction.
- [ ] Concurrency test on a real multi-connection Postgres. PGlite runs one connection, so it
      proves the retry path but not true parallel locking. Needs a local Postgres server
      (only the client tools are installed) — or a second Supabase project.

**Customer web app** (React + Vite, in `web/`) — done; 13 UI tests run the real app against the real API on Postgres
- [x] Scaffold the app; proxy `/api` to the server in dev
- [x] `/t/:qrToken` — load menu, store the guest session id in `localStorage`
- [x] Menu by category, veg markers, add-to-cart with notes
- [x] Cart: edit quantity/notes, remove lines, subtotal from the server
- [x] Place order → confirmation screen with the order number and "pay at the counter"
- [x] Handle: session expired (ask to rescan), item became unavailable at checkout (show
      which, let them remove it), ordering unavailable, offline/retry without duplicates

- [ ] Try it on a real phone over your LAN (`npm run dev` in `web/` prints a Network URL; open `/t/<qr_token>`) and with a real printed/on-screen QR code.

**Bill** (added after the first hands-on test — orders vanished once you left the confirmation)
- [x] `GET /bill`: this session's orders + totals; cancelled orders listed, not charged
- [x] `has_orders` on the menu response drives the "Your bill" button
- [x] Sessions renew on activity (3 h after the last request), so the bill stays reachable
- [x] Bill screen (`#bill`): View bill on the confirmation, Your bill on the menu, Refresh, Order more
- [x] One-command dev: `npm run dev` at the repo root starts API + web
- [ ] Known limit: a session idle for 3+ hours expires and its bill is no longer reachable from
      that phone — the customer asks at the counter. A staff-side table bill (step 4/5) covers it.

## Step 4 — SSE + staff dashboard

**API**
- [ ] `GET /orders?status=&table_id=` — scoped to the staff member's restaurant, newest first
- [ ] `GET /orders/:orderId` — lines + timeline from `order_status_events`, with staff names
- [ ] `PATCH /orders/:orderId/status` — reject illegal transitions with 400; run it through
      `db.withTransaction(fn, { actorId })` so the event log records who made the change
- [ ] SSE stream
  - in-memory connections keyed by `restaurant_id`; `:restaurantId` must match the staff
    member's own
  - heartbeat comment every ~25s so proxies don't drop idle connections
  - send `order_created` from `POST /orders` and `order_status_changed` from the status
    route, after commit
  - **auth:** the browser's `EventSource` can't send an `Authorization` header — decide
    between a short-lived stream ticket in the query string or a cookie
  - on reconnect the dashboard refetches `GET /orders` rather than replaying missed events
  - close all streams on shutdown (`src/index.js`)

**Dashboard UI**
- [ ] Staff sign-in with Supabase Auth; `GET /me` for role and restaurant
- [ ] Order board: columns by status, table label, order number, lines and notes
- [ ] One-tap status moves, showing only the legal next states
- [ ] Time in current status; highlight orders stuck too long
- [ ] Order detail with timeline (who moved it, when)
- [ ] Sound or visual alert on new orders

## Step 5 — Owner admin panel

- [ ] `GET/POST/PATCH/DELETE /items` — owner only, soft delete, restaurant-scoped
- [ ] `PATCH /items/:itemId/availability` — owner and staff
- [ ] `GET /tables`, `POST /tables`
- [ ] Printable QR sheet: `{APP_BASE_URL}/t/{qr_token}` per table
- [ ] Admin UI: menu editor, availability toggles, tables + QR download
- [ ] Optional: rotate a table's QR token if a printed code leaks

## Step 6 — Landing page

- [ ] Built last, with real screenshots of the working flow

## Before first real cafe

- [ ] Deploy: API on Render/Railway, web app on Vercel/Netlify
- [ ] Verify staff tokens locally (JWT signature) instead of a network call per request
- [ ] Structured request logging

## After v1 (out of scope, not forgotten)

- Payments: `POST /payments` against the existing model; `order_payment_updated` SSE event
- Invoices by email/SMS (manual trigger)
- Customer-facing order status
- RLS policies (and `restaurant_id` on `cart_items` / `order_items` to support them)
- Redis pub/sub for SSE across multiple API instances
- Staff "mark as paid" without a payment row, if cafes want paid/unpaid on the board
- Table-level bill on the staff side (all sessions at a table, incl. after a session expires)
- Print / save the bill as PDF; tax invoices (with invoices, above)
- Pause QR ordering for a single table
- Separate kitchen and reception views
- Structured modifiers, stock counts, tax engine, customer login
