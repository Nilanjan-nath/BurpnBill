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
- A QR order is **accepted or turned away by staff before the kitchen sees it**. It waits in a
  POS queue rather than going straight to the board — the counter is the check on a QR code
  anyone at the table (or anyone who kept the link) can use. Staff-placed POS orders skip the
  queue: the person placing it is the person who would approve it **(decided, step 6)**
- Customer adds items to a cart, with free-text special instructions per item
- Customer places an order directly from the app (no login required)
- Customer pays at the counter; payment happens outside the app **(decided)**
- Customer can open a read-only **bill** — every order placed from their phone, with the
  total to pay — and show it at the counter **(decided)**
- Owner keeps the café's own profile — name, address, phone, currency — its **seating plan**
  (tables, their QR codes, renaming and pausing), and every staff member manages their own
  name and password **(decided, step 6)**
- Owner adds, edits, and deletes menu items, **with a photo and a category** — categories are
  records the owner creates and orders, and a photo is uploaded through the API into Supabase
  Storage **(decided, step 6)**
- Owner and staff toggle item availability on/off (86'd items disappear from the menu)
- Owner and staff see live incoming orders per table on one shared dashboard, update
  their status, and see each order's status timeline **(decided)**
- QR codes are mapped to specific tables so orders are attributed correctly

### Out of scope for v1

- **Taking payment in-app** — no gateway, no card processing, nothing that moves money. The
  counter takes cash/card/UPI as it always has. What step 6 added is a *record* of that: POS's
  checkout writes a real `payments` row saying which method was used, which is what marks the
  orders paid and frees the table (see §7's `POST /tables/:tableId/checkout`). Wiring an actual
  gateway later is new code against the same schema, not a migration **(decided)**
- **Discounts, tips, split bills, partial payments, tax** — none of these have any schema, and
  `orders.tax_amount` is always 0 (no tax engine). The Settings screen deliberately carries **no
  tax-rate field** for that reason: storing a rate the app then ignores would promise a tax
  nothing charges. Applying one is a change to how every order is priced — order creation, both
  bills, checkout and the dashboard's takings all read those totals — so it is its own piece of
  work, not a settings field **(decided, step 6)**. Each is its own piece of work; the checkout
  screen deliberately stops at "what's owed, and how was it paid" **(decided, step 6)**
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
restaurants ──< menu_categories ──< menu_items
restaurants ──< menu_items          restaurants ──< staff_members
```

- **Restaurant** — one row per cafe/tenant. Everything else scopes to `restaurant_id`.
- **Table** — belongs to a restaurant; holds an opaque `qr_token` the QR code encodes, a
  position on the floor plan (`pos_x`/`pos_y`, grid cells), and `deleted_at` for retiring one
  without erasing its orders **(extended, step 6)**.
- **MenuCategory** — a section of the menu, belonging to a restaurant: a name and a
  `display_order`. Exists as a record so a category can be created before anything is in it,
  and so menu order is the owner's rather than the alphabet's **(added, step 6)**.
- **MenuItem** — belongs to a restaurant; `is_available`, price, soft delete, and a nullable
  `category_id`. **Null means Uncategorised** — a real state, not missing data: it keeps
  `POST /items`'s "name and price, everything else optional" contract, and means deleting a
  category has somewhere to put its items without a magic fallback row **(changed, step 6)**.
  `image_url` holds an owner-uploaded photo (see §8).
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
- **Roles (decided, three since step 6)**: `owner` does everything, including the menu, tables
  and staff management. `staff` is **front of house**: the order board, 86'ing items, and the
  till — POS, accepting QR orders, and settling a table. `kitchen` is the order board and
  86'ing only. The split exists because a QR order only the owner could accept is an order that
  waits for the owner to be standing at the till.
- **Invites (decided)**: `staff_members.user_id` is the primary key and, on Supabase, a foreign
  key to `auth.users` — so a person must already exist as an auth user before they can be
  linked. An invite is therefore a **pre-authorised email** in `staff_invites`, not an account:
  the owner adds an address and role, the person signs up themselves, and their first
  authenticated request claims the invite (`middleware/auth.js`). **No email is sent** —
  Supabase's built-in invite mail is rate-limited and unreliable without custom SMTP, and
  nothing here should depend on deliverability. The address is only as trustworthy as
  Supabase's own "Confirm email" setting, which is what proves the person owns the inbox;
  invites expire after 7 days and can be revoked, to keep that window small.
- **Settings (decided, step 6)**: the café's profile and its seating plan are the café's, so
  they are the owner's — `PATCH /restaurant` and `PATCH /tables/:id` are owner-only, while the
  *reads* are open to any staff member because the currency alone decides how every price on
  their screen is formatted. **Your own account is yours**: `PATCH /me` changes your display
  name and accepts nothing else — a role is not a field there at all, so no login can promote
  itself. A password change never reaches this API: the browser's own Supabase client holds the
  session and changes it directly, so no password is sent to, or logged by, a server we wrote.
- **Sign-up (added):** because an invite creates no login, `/staff` has a sign-up mode beside
  sign-in — otherwise an invited person has no way in at all. Anyone may create an account;
  that alone grants nothing, since access comes from claiming an invite. With Supabase's
  "Confirm email" on, `signUp` returns no session until they click Supabase's own confirmation
  mail, so the screen says so rather than appearing to hang.
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
- `POST /orders` — `{ cart_id }` converts that cart into an order. 201 the first time, 200 with the same order on a retry; 409 `items_unavailable` (with the lines) if anything was 86d since it was added. The order lands **unapproved** and waits in the staff approval queue below; the kitchen does not see it yet **(changed, step 6)**

Removed from v1: `GET /orders/:order_id` (customer tracking), `POST /payments`,
`POST /invoices`.

### Private (staff/owner, authenticated + restaurant-scoped)

- `GET /me` — the signed-in staff member and their restaurant **(added)**
- `PATCH /me` — your own `display_name`, and nothing else. Never a role **(added, step 6)**
- `GET /restaurant` — any staff member; the café's name, address, phone and currency
- `PATCH /restaurant` — owner only; partial. `address` and `phone` are clearable (an explicit
  null differs from omitting the field); `name` and `currency_code` are not. The currency is
  normalised to upper case and validated as three letters here, since the column's own check
  only enforces the length **(added, step 6)**
- `GET /orders?status=&table_id=` — order board initial load (active orders + server time). Only approved orders: a QR order the counter hasn't accepted is not the kitchen's problem
- `GET /orders/pending` — the QR approval queue, oldest first, with lines and totals **(added, step 6)**
- `POST /orders/:orderId/approve` — hand a queued order to the kitchen. Locks the row first, so two people accepting at once can't both win; the loser gets a 409 like any lost race. Publishes `order_created` — this is the moment the kitchen hears about it **(added, step 6)**
- `POST /orders/:orderId/reject` — turn one away. Cancels it through the same path as any other cancellation (timeline, actor), and refuses anything that has already left the queue **(added, step 6)**
- `GET /orders/recent` — served/cancelled orders, newest-finished first; default 4h, `?hours=` up to a week **(added)**
- `GET /orders/:orderId` — lines, notes, totals and status timeline (who changed it, when) **(added)**
- `PATCH /orders/:orderId/status` — validated against §5; 409 on an illegal or lost-race move
- `GET /orders/stream` — SSE stream for the live board; scoped by the signed-in staff member and read with fetch + an Authorization header **(changed)**
- `GET /items` — admin menu list, including 86'd items **(added)**
- `POST /items`, `PATCH /items/:itemId`, `DELETE /items/:itemId` (soft) — owner only
- `PATCH /items/:itemId/availability` — owner and staff
- `PUT /items/:itemId/image` — owner only; the photo's **raw bytes** with an image
  `Content-Type` (PNG/JPG/WEBP, 5MB cap), not multipart — there is exactly one file and no
  other fields travel with it, so `express.raw` is the whole parser. The upload goes through
  the API rather than straight from the browser to Supabase: a signed upload URL would save a
  hop, but it would mean the browser telling the server where the file landed and the server
  writing that string into `image_url` on trust. This way the service-role key is the only
  thing that can write to the bucket, and the URL stored is one the server produced. Replacing
  a photo writes a new path (so a cached copy of the old one can't win) and deletes the file it
  replaced; deleting the item deletes its file too **(added, step 6)**
- `DELETE /items/:itemId/image` — owner only; clears the column and the file **(added, step 6)**
- `GET /categories` — owner and staff (the Menu tab groups by them for the kitchen too)
- `POST /categories` — owner only; `{ name, display_order? }`. An omitted `display_order`
  puts the category at the **end** of the menu — a new section almost never belongs first, and
  landing on 0 would silently reorder the menu. A duplicate name is a 409 from
  `menu_categories_name_key` (case- and whitespace-insensitive), not an app-level check, so
  there's no read-then-write race to lose **(added, step 6)**
- `PATCH /categories/:categoryId` — owner only; rename and/or reorder. Renaming never touches
  the items — they point at the record, which is the whole reason this stopped being a string
- `DELETE /categories/:categoryId` — owner only. **Deleting a section never deletes the food in
  it**: its items move to Uncategorised in the same transaction, which is also why the foreign
  key has no `ON DELETE` action — the move is deliberate, not a side effect. Returns
  `moved_items` so the UI can say where they went **(added, step 6)**
- `DELETE /tables/:tableId` — owner only, and a **soft** delete (`deleted_at`). It has to be:
  `orders.table_id` cascades, so a real delete would erase every order ever placed at that
  table. **Refused with 409 while the table still owes money** — retiring a table mid-service
  would hide a bill nobody would ever see again. A retired table stops appearing anywhere, its
  QR code stops resolving (404), and it gives up both its name and its cell for the next one
  **(added, step 6)**
- `PATCH /tables/:tableId` — owner only; rename, change the seat count, **move it on the floor
  plan** (`pos_x`/`pos_y`, both or neither), or **pause** a table.
  Pausing is what `is_active` was always for: `openMenu` already refuses an inactive table with
  403 `ordering_unavailable`, so a paused table's QR code stops taking orders immediately and
  starts again when it's unpaused — nothing is reprinted. The `qr_token` is deliberately not
  touchable: it is printed on something physical, and changing it would turn every copy into a
  dead link **(added, step 6)**
- `GET /tables` — owner and staff; `POST /tables` — owner only. The Tables *tab* in the dashboard
  is owner only regardless — staff have no reason to add tables or print QR sheets — so the API's
  wider allowance is unused by the UI, not a mismatch
- `GET /dashboard/summary?tz=` — owner only (it reports money). Today's takings kept separate
  from what's still open on tables, order and cancellation counts, the kitchen's live queue
  including the QR approval backlog, table occupancy on the floor map's own definition, average
  kitchen-to-ready time, today's best sellers, and menu/team counts. **"Today" is the café's
  day**: Postgres runs in UTC, where the boundary falls at 05:30 IST — mid-morning-shift — so
  the caller passes its IANA zone and the boundary is computed in it, resolved against
  `pg_timezone_names` with a UTC fallback. Also returns the analytics the screen is built on:
  sales by hour (on `placed_at` — when the café is busy, not when money was banked), the same
  time **yesterday** for comparison, the last seven days, the payment mix from real `payments`
  rows, and a QR-vs-counter split **inferred from `orders.cart_id`** — a customer's order is
  converted from a cart and a POS order never has one, which is why `orders.source` has still
  not been needed **(added, step 6)**
- `GET /staff` — owner only; the team plus the invites still waiting to be claimed **(added, step 6)**
- `POST /staff/invites` — owner only; pre-authorise `{ email, role, display_name? }`. Re-inviting an address replaces the open invite rather than erroring **(added, step 6)**
- `DELETE /staff/invites/:inviteId` — withdraw one that hasn't been claimed **(added, step 6)**
- `PATCH /staff/:userId` `{ role }` and `DELETE /staff/:userId` — change a role, or unlink someone. Removing leaves their Supabase Auth account alone: that identity may be used elsewhere. Both refuse to remove the **last owner** — a cafe with no owner has nobody who can put one back **(added, step 6)**
- `GET /floor` — front of house (owner or staff), not the kitchen. Carries the floor-plan
  positions and reads in layout order, so POS draws the room the owner actually arranged
  rather than the order tables were added **(extended, step 6)**. Every table plus whether it's occupied, derived from active orders,
  no new schema. Also carries the table's running bill (`unpaid_total`, `unpaid_count`, summed
  over every unpaid order, not just the newest) and its `qr_token`, so POS can show what a table
  owes and its QR code without a second request **(added, step 7; extended, step 6)**
- `POST /staff/orders` — front of house; a staff-placed order for a walk-in, dine-in only. Reuses the
  customer checkout path's guarantees (locked availability check, server-computed total) but
  skips the guest-session/cart concept entirely except for the one throwaway `guest_session` row
  each order needs to satisfy `orders.guest_session_id`'s FK **(added, step 7)**
- `GET /tables/:tableId/bill` — front of house; the staff-side table bill: every unpaid,
  non-cancelled order on the table with its lines and totals. Scoped by table, unlike the
  customer's `GET /bill`, which is scoped to one guest session — at the counter you settle the
  whole table, not one person's phone **(added, step 6)**
- `POST /tables/:tableId/checkout` — front of house; `{ method, idempotency_key }`. Records **how**
  the money was taken at the counter (`cash` | `card` | `upi`) as a real `payments` row per
  order, and the existing `payments_sync_order_paid_at` trigger sets `orders.paid_at`, which is
  what frees the table on the floor map. **No money moves here and there is no payment gateway**
  — per §2 the customer pays at the counter and this records which way; `payments.provider_ref`
  stays null, reserved for the day a gateway does move money. The caller's idempotency key is
  suffixed per order, so a double-tapped Confirm is one settlement, not two. Settles orders in
  any live status, not just `served` — paying before the food lands is normal, and the caller
  now confirms against the itemised bill above **(changed, step 6)**

### Realtime (SSE)

- Custom Server-Sent Events from Express — not Supabase Realtime, not websockets. Data flows
  one way (server → dashboard), and the server already knows about every change because it
  makes them.
- Events in v1: `qr_order_pending`, `order_created`, `order_status_changed`.
  (`order_payment_updated` arrives with payments.) A QR order publishes `qr_order_pending` —
  the POS approval queue, not the kitchen. `order_created` fires when staff approve it, or
  immediately for a staff-placed POS order, and that is what the board listens for.
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
- **Styling**: the customer app is plain CSS (`styles.css`). The staff dashboard's sidebar,
  header and POS page are Tailwind CSS v4 (`@tailwindcss/vite`, no config file) plus
  `lucide-react` for icons **(added, step 7)** — a deliberate "premium SaaS" look distinct from
  the customer app's warm palette, per direct owner design feedback. Rules and palette (teal
  accent, chosen specifically to not match reference screenshots' blue — see the doc for why)
  are written up in `docs/design.md`, meant to apply to every tab over time, not just POS. Both
  Tailwind and lucide-react are scoped to the `/staff` lazy chunk only (imported from
  `staff/tailwind.css`, itself only reachable via `StaffApp.jsx`), verified with a production
  build to never reach the customer bundle. The reverse direction is **not** automatic, and bit
  us: `styles.css` loads on every route (it's imported by `main.jsx`), so its global element
  rules also apply to `/staff`. They live in `@layer petuk-customer` for that reason — unlayered
  CSS outranks anything in a cascade layer, and Tailwind v4 puts all its utilities in one, so
  left unlayered the customer reset silently won over every dashboard utility **(added, step 6)** The rest of the staff
  dashboard (Board/Recent/Tables) still uses the older plain-CSS dark theme, scoped to
  `.staff-legacy` — a known, temporary visual seam until those pages are migrated too. The Menu
  tab joined the Tailwind system in step 6, with photo cards, a search field and its own
  Categories view
- **Item photos (added, step 6)**: a public `menu-images` bucket in Supabase Storage, created on
  demand by the API rather than as a setup step the owner has to remember. Public read because
  these are menu photos on a page anyone at a table can open — signing every URL would buy
  nothing and cost a round trip per item. The customer menu renders them as a fixed square
  thumbnail, so a tall photo and a wide one don't make the rows jump as they load
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
6. **Owner operations dashboard** — in progress: floor map, staff-placed POS orders (dine-in
   only), a today's-snapshot dashboard, staff invite/role management. Still 2 roles
   (owner/staff), so these are all owner-only surfaces — see `TASKS.md` step 7 for the
   decisions and slice breakdown
7. **Landing page** — last, once there's a real flow to show. Real multi-restaurant signup
   (name/owner/email) likely belongs here too, not step 6

After v1: payments, invoices, a richer role set (cashier/waiter, so POS isn't owner-only),
multi-restaurant self-serve signup (see §2).
