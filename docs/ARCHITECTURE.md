# Petuk — Architecture & Build Plan

*Source of truth for what v1 is. Decisions made after the original design doc are
marked **(decided)**. Open work lives in [TASKS.md](TASKS.md); schema detail in
[schema.md](schema.md).*

## 1. Problem statement

Small cafes/restaurants (especially in tier-2/3 towns) struggle with table service during
rush hours — waitstaff can't reach every table in time to take orders, causing delays and
missed orders. Petuk lets customers scan a QR code at their table, browse the menu,
and place an order directly — which appears instantly on a live kitchen/reception dashboard.

## 2. Functional requirements (v1)

- Customer scans a QR code at a table and sees that cafe's live menu
- Customer adds items to a cart, with free-text special instructions per item
- Customer places an order directly from the app (no login required)
- Customer pays at the counter; payment happens outside the app **(decided)**
- Customer can open a read-only **bill** — every order placed from their phone, with the
  total to pay — and show it at the counter **(decided)**
- Owner adds, edits, and deletes menu items
- Owner and staff toggle item availability on/off (86'd items disappear from the menu)
- Owner and staff see live incoming orders per table on one shared dashboard, update
  their status, and see each order's status timeline **(decided)**
- QR codes are mapped to specific tables so orders are attributed correctly

### Out of scope for v1

- **Payments** — in-app or mocked. The schema already models them (see §4) so adding them
  later is new code, not a migration **(decided)**
- **Invoices** (email/SMS) — planned for after v1 **(decided)**
- Customer-facing live order-status tracking, including polling an order's status **(decided)**.
  The bill lists what was ordered; it does not show whether the kitchen has started on it.
- Customer login / OTP-based authentication
- Stock-count auto-decrementing (boolean availability only)
- Structured order modifiers (size/spice/add-ons) — free-text notes only
- Separate kitchen and reception views — one board for everyone **(decided)**

## 3. Non-functional requirements

- **Order uniqueness per table**: if two people scan the QR at the same table and each
  place an order, these are separate orders, never merged — each scan gets its own
  `guest_session`, and orders hang off the session.
- **No duplicate orders from retries**: a double-tapped or network-retried "Place order"
  must produce one order. The server-side cart converts into an order at most once
  **(decided)**.
- **Low latency menu reads**: one indexed scan (partial index on live, available items).
- **Menu correctness over stale availability**: an 86'd or deleted item must never be
  orderable. The cart is re-validated against the live menu at checkout.
- **Idempotent payments** (when built): unique `idempotency_key` on `payments`, already in
  the schema.

## 4. Core entities & relationships

```
restaurants ──< restaurant_tables ──< guest_sessions ──< carts ──< cart_items
                       │                    │                          │
                       └────────────────────┴──< orders ──< order_items ┘
                                                  │   └──< order_status_events
                                                  └──< payments   (unused in v1)
restaurants ──< menu_items          restaurants ──< staff_members
```

- **Restaurant** — one row per cafe/tenant. Everything else scopes to `restaurant_id`.
- **Table** — belongs to a restaurant; holds an opaque `qr_token` the QR code encodes.
- **MenuItem** — belongs to a restaurant; `is_available`, price, category, soft delete.
- **GuestSession** — created per QR scan (no login), tied to a table, expires 3 hours after its last activity.
- **Cart / CartItem** — server-side cart, at most one open cart per guest session
  **(decided)**. Same item with different notes is a separate line.
- **Order** — belongs to a table + restaurant + guest session; has a `status` (§5) and
  a short `order_number` (#1001) for the kitchen.
- **OrderItem** — snapshots `price_at_order` and `name_at_order`, so menu edits never
  rewrite history.
- **OrderStatusEvent** — append-only log of every status change, with who made it.
- **StaffMember** — links a Supabase Auth user to one restaurant with a role
  (`owner` or `staff`).
- **Payment** — modelled, unused in v1.

## 5. Order status state machine

States: `placed → preparing → ready → served`, plus `cancelled`.

Valid transitions only:
- `placed → preparing`
- `placed → cancelled`
- `preparing → ready`
- `preparing → cancelled`
- `ready → served`

`PATCH /orders/:id/status` locks the order's row first, so two staff tapping the same order at
once are serialised by Postgres, not by app code; the request that loses the race gets 409 with
the order's real current status and who set it — the same response a genuinely illegal move gets,
since both cases mean "your view is stale, here's what's actually true" **(decided)**. A database
trigger enforces the same table as a backstop, in case the two ever drift apart.

## 6. Security model (prototype-level, explicitly not full auth)

- **Guest sessions** are a random id returned by `GET /menu/:qr_token`, stored by the web
  app in `localStorage`, and sent back in an `X-Guest-Session` header **(decided)**. They
  expire 3 hours after the last request (any activity renews them, so a party lingering over
  chai can still open their bill); expiry is checked on every cart/order/bill request.
- QR codes encode an opaque `qr_token`, not a table number, so tables can't be enumerated.
- This is **not** authentication — the threat model is accidental order conflation between
  customers at one table. A shared or bookmarked link can still place an order.
- **Staff/owner routes** require a Supabase Auth access token (`Authorization: Bearer`).
  The server looks up the user's restaurant in `staff_members` and scopes every query by
  it — never by an id taken from the request.
- **Roles (decided)**: owners can do everything; staff can work the order board and toggle
  item availability, but not edit the menu or tables.
- **RLS** is enabled on every table with no policies, so the public anon key can read or
  write nothing directly. The API uses the service-role key and a direct Postgres
  connection, which bypass RLS. Writing real policies is deferred.

## 7. API

All routes are under `/api`. Errors are always `{ "error": { "code", "message", ... } }`.

### Health

- `GET /health` — process is up
- `GET /health/ready` — database and Supabase Auth reachable (503 if not)

### Public (customer-facing, guest session)

- `GET /menu/:qrToken` — resolve table, create/reuse guest session, return available menu
- `GET /cart` — current open cart **(added)**
- `POST /cart/items` — `{ menu_item_id, quantity, special_instructions }`
- `PATCH /cart/items/:cartItemId` — change quantity/notes **(added)**
- `DELETE /cart/items/:cartItemId` — remove a line **(added)**
- `GET /bill` — read-only summary of this session's orders: items, notes, per-order and grand
  totals. Cancelled orders are listed but not charged. Scoped to the guest session, never the
  table, so other guests' orders stay private **(added)**
- `POST /orders` — `{ cart_id }` converts that cart into an order. 201 the first time, 200 with the same order on a retry; 409 `items_unavailable` (with the lines) if anything was 86d since it was added

Removed from v1: `GET /orders/:order_id` (customer tracking), `POST /payments`,
`POST /invoices`.

### Private (staff/owner, authenticated + restaurant-scoped)

- `GET /me` — the signed-in staff member and their restaurant **(added)**
- `GET /orders?status=&table_id=` — order board initial load (active orders + server time)
- `GET /orders/recent` — served/cancelled orders, newest-finished first; default 4h, `?hours=` up to a week **(added)**
- `GET /orders/:orderId` — lines, notes, totals and status timeline (who changed it, when) **(added)**
- `PATCH /orders/:orderId/status` — validated against §5; 409 on an illegal or lost-race move
- `GET /orders/stream` — SSE stream for the live board; scoped by the signed-in staff member and read with fetch + an Authorization header **(changed)**
- `GET /items` — admin menu list, including 86'd items **(added)**
- `POST /items`, `PATCH /items/:itemId`, `DELETE /items/:itemId` (soft) — owner only
- `PATCH /items/:itemId/availability` — owner and staff
- `GET /tables` — owner and staff; `POST /tables` — owner only. The Tables *tab* in the dashboard
  is owner only regardless — staff have no reason to add tables or print QR sheets — so the API's
  wider allowance is unused by the UI, not a mismatch

### Realtime (SSE)

- Custom Server-Sent Events from Express — not Supabase Realtime, not websockets. Data flows
  one way (server → dashboard), and the server already knows about every change because it
  makes them.
- Events in v1: `order_created`, `order_status_changed`. (`order_payment_updated` arrives
  with payments.)
- Broadcast via an in-memory connection map keyed by `restaurant_id`, inside the single
  Express instance. Multiple instances would need shared pub/sub (e.g. Redis) — a known
  limitation, not solved now.
- Read with `fetch` + an `Authorization` header, not the browser's `EventSource` — it can't send
  custom headers, and the alternative (a token in the URL, or a separate cookie-based session
  just for this one endpoint) isn't worth it for one stream **(decided)**. No replay: a
  dashboard that reconnects just calls `GET /orders` again rather than the server trying to
  catch it up on what it missed.
- The dashboard (`web/src/staff/useOrderStream.js`) reconnects on any drop with exponential
  backoff (1s, capped at 15s), always shows "Live" or "Reconnecting…" rather than failing
  silently, and patches a pushed order straight into its own list — a full `GET /orders` only
  runs on first load, after an action that tab itself took, or after a reconnect. Order ages use
  `server_time` (already in `GET /orders`) rather than the device's own clock, which a kitchen
  tablet cannot be trusted to have set correctly.

## 8. Tech stack

- **Backend**: Node.js 22+ and Express 5, in `server/` (long-running process, needed for SSE)
- **Data access (decided)**: `pg` connecting directly to Postgres through the Supabase
  session pooler, because placing an order needs a real transaction.
  `@supabase/supabase-js` is used only to verify staff access tokens.
- **Database**: Supabase (hosted Postgres 15+)
- **Auth**: Supabase Auth, staff/owner only (email + password)
- **Frontend**: React (Vite) — one web app for customers and staff, no native app. The staff
  dashboard (`/staff`) is lazy-loaded, so customers never download it. It signs in with its own
  Supabase Auth client, built from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in a separate
  `web/.env` — never the service-role key, which stays in the server's own `.env` **(decided)**
- **Package manager**: npm
- **Hosting (later)**: Render/Railway (backend), Vercel/Netlify (frontend), Supabase

## 9. Build order

1. ~~**Database schema**~~ — done
2. ~~**Backend scaffolding**~~ — done: Express app, database and Supabase wiring, staff
   and guest-session middleware, stubs for every v1 route, tests
3. ~~**Public flow end-to-end**~~ — done: QR scan → guest session → menu → cart → order, in the
   API and the customer web app (`web/`)
4. ~~**SSE + staff dashboard**~~ — done: live order board, status updates, order timeline
5. ~~**Owner admin panel**~~ — done: menu CRUD, availability toggle, tables and printable QR codes
6. **Landing page** — last, once there's a real flow to show

After v1: payments, invoices (see §2).
