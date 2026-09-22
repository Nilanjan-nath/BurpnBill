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
      (only the client tools are installed) — or a second Supabase project. Same gap applies to
      the `PATCH /orders/:id/status` race test in step 4.

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

## Step 4 — Live staff dashboard

**Decided:** lives in the same web app at `/staff` (lazy-loaded, so customers never download it) ·
three columns New | Preparing | Ready · served/cancelled leave the board and a Recent tab keeps the
last few hours · new-order sound (one-time "Turn on sound" tap) plus a flashing tab title with the
count · owner and staff share one board · no undo (the state machine is forward-only); only Cancel
asks for confirmation.

Five slices, each tested, documented and committed on its own:

**Slice 0 — Link your staff login** (you; needed before slice 1 can be tried for real)
- [x] Supabase → Authentication → Users → Add user (email + password, auto-confirm); copy the UID
- [x] `insert into public.staff_members (user_id, restaurant_id, role, display_name) values ('<uid>', '11111111-1111-1111-1111-111111111111', 'owner', '<name>');`

**Slice 1 — Orders API**
- [x] `GET /orders` — board load: active orders (placed/preparing/ready) plus `server_time`;
      optional `?status=&table_id=`; scoped to the staff member's restaurant, oldest first
- [x] `GET /orders/:id` — lines + status timeline with staff names (join `staff_members`)
- [x] `GET /orders/recent` — served/cancelled orders, newest FINISHED first (not newest placed);
      default 4h window, `?hours=` 1-168
- [x] `PATCH /orders/:id/status` `{ status }` — locks the row (`for update`) before checking the
      transition, so two staff tapping at once are serialised by Postgres itself, not by app
      code; the loser gets 409 with the order's real current status and who set it; another
      café's order or a made-up id is 404; runs through `db.withTransaction(fn, { actorId })` so
      the log records who. The database's own trigger is a backstop: disabling the app-level
      check on purpose still gets rejected, just as a plain 400 instead of the friendlier 409.
- [x] Tests on real Postgres: every legal edge, terminal states, cross-café 404, actor recorded,
      and a genuine `Promise.all` race between two staff. **Known gap:** the race test runs on
      PGlite, which is a single connection — it proves the app logic picks exactly one winner,
      not that real, separately-connected Postgres clients actually block on the row lock. Same
      caveat as the order-placement race test below; both need the local Postgres / second
      Supabase project already listed there.

**Slice 2 — Live push (SSE)** — done (server side; the dashboard that connects to it is slice 3/4)
- [x] `src/orderStream.js`: in-memory hub, `Set<res>` keyed by `restaurant_id`. `subscribe` wires
      its own cleanup (`res.on('close')`); `publish` writes an SSE frame to every open connection
      for that café only; `closeAll` ends every stream so shutdown doesn't hang waiting for
      connections that never finish on their own; `connectionCount` for tests/diagnostics
- [x] `getBoardCard` + `publishBoardCard` in `staffOrders.js`: fetches the fresh, committed row in
      the same shape `GET /orders` returns, and publishes it — shared by `POST /orders`
      (`order_created`, only on a genuine create, never on the idempotent-retry path) and
      `PATCH /orders/:id/status` (`order_status_changed`); publish failures only log, never break
      the request that triggered them
- [x] `GET /orders/stream` — registered before `/orders/:orderId` (dropped the redundant
      `:restaurantId` path prefix from the original design); `X-Accel-Buffering: no`; opening
      frame so the client knows the connection is live; ~25s heartbeat (configurable, for tests)
- [x] Auth: read with `fetch` + `Authorization`, not `EventSource` (can't send headers) — see
      ARCHITECTURE §7. No reconnect logic yet; that's the dashboard's job in slice 4
- [x] `src/index.js`: hub closed first on shutdown, before `server.close()`
- [x] Tests (real Postgres): a live stream reads real pushed frames from real placed/moved
      orders; retries never double-push; rejected moves never push; heartbeats arrive; café
      isolation; a closed connection is actually removed (`connectionCount`), not just silent.
      Three mutations checked by hand — one (a `node -e` string-replace) silently failed to
      apply and gave a false pass; redone with the Edit tool and confirmed for real

**Slice 3 — Sign-in and static board**
- [ ] `/staff` route, lazy-loaded; Supabase Auth email + password; expose only `SUPABASE_URL` and
      `SUPABASE_ANON_KEY` to the web build — never the service-role key
- [ ] Three-column board; card = order number, table, items + notes, age; one-tap forward button;
      Cancel with confirmation; "already moved by <name>" handled by refreshing
- [ ] Tablet/desktop layout; UI tests with a stubbed auth module

**Slice 4 — Going live**
- [ ] Connect the stream; `server_time` offset so age timers ignore the device clock
- [ ] "Live / Reconnecting…" indicator (never fail silently); full refetch after a reconnect
- [ ] New-order sound + tab title "(2) New orders"; stuck highlight (amber/red by minutes waiting)

**Slice 5 — Detail and Recent**
- [ ] Order detail drawer with the timeline (who moved it, when)
- [ ] Recent tab (served/cancelled, last few hours)

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
