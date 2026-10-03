# BurpnBill — Architecture & Build Plan

*Source of truth for what v1 is. Decisions made after the original design doc are
marked **(decided)**. Open work lives in [TASKS.md](TASKS.md); schema detail in
[schema.md](schema.md).*

## 1. Problem statement

Small cafes/restaurants (especially in tier-2/3 towns) struggle with table service during
rush hours — waitstaff can't reach every table in time to take orders, causing delays and
missed orders. BurpnBill lets customers scan a QR code at their table, browse the menu,
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
  screen deliberately stops at "what's owed, and how was it paid" **(decided, step 6)**.
  **Changed in step 14 (billing, phase B): optional GST, as a bill-level split, not order pricing.**
  Prices stay tax-INCLUSIVE and `orders.tax_amount` stays 0, so order creation, both bills' totals and
  the dashboard's takings are untouched. A café that is GST-registered turns it on in Settings
  (`restaurants.gst_enabled`, `gstin`, one `gst_rate`); at checkout the bill carves tax out of the total
  (tax = total x rate / (100 + rate), CGST half, SGST the rest, taxable value the remainder) and stores
  the split with the rate and registration numbers, frozen. One rate per café; per-item rates, exclusive
  pricing, inter-state IGST and credit notes are not built. Discounts, tips, split bills and partial
  payments still have no schema
- **Invoices** (email/SMS) — planned for after v1 **(decided)**
- ~~Customer-facing order-status tracking~~ **Reversed (step 8):** the customer's phone now shows
  where each order is — waiting for the counter, accepted, being prepared, ready, served or
  cancelled — by polling `GET /orders/status`. Still out: a time estimate (nothing records
  one), push notifications, and any live connection to a customer (see §7).
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

- **Rate limiting** **(decided, built)**: the database pool is about 5 connections, so one
  noisy client could take a café's board down. Public routes are limited per client with
  `express-rate-limit` (in memory; the app is single-instance anyway, §7 Realtime). Two
  layers: **per guest session** for the routes a phone polls or writes (`POST /orders` 10 a
  minute, status 20, cart and bill 60), so two diners behind one café Wi-Fi never share a
  bucket; and **per IP** (menu 120 a minute, receipts 30, create-a-café 5 an hour, plus a
  1000-a-minute backstop over every public route, so an invented session id per request
  cannot dodge the limit and one café never reaches it). Limits run before authentication and
  before any query. A blocked request is `429` `rate_limited` with `Retry-After`. Health
  checks, the order stream and the staff routes are not limited. Numbers are
  `DEFAULT_RATE_LIMITS` in `middleware/rateLimit.js`. The client IP is only real if Express
  trusts the proxy (`trust proxy` = `loopback`, Caddy) and Caddy passes the verified visitor
  (Cloudflare's ranges, `deploy/Caddyfile`). Supabase's own sign-up call goes from the browser
  to Supabase and is outside this; Supabase limits it.

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
  authenticated request claims the invite (`middleware/auth.js`). **The invitee is emailed**
  (step 15): `POST /staff/invites` saves the invite and then calls Supabase Auth's
  `inviteUserByEmail`, which sends from the SMTP sender configured in the dashboard (Brevo).
  The link lands on `/staff` already signed in, with `invited: true` in the user metadata; the
  dashboard asks for a password (`SetPasswordScreen`, then `password_set: true`) and the first
  request links them. The invite row is what grants access, so a mail failure never loses it:
  the response says `email: sent | has_account | failed` and the Staff screen words each, with
  a Resend button. An address that already has a login is not emailed; signing in is enough.
  Revoking an invite leaves any login the email created alone (it grants no café). The address
  is only as trustworthy as Supabase's own "Confirm email" setting, and an invite link click
  is itself proof of the inbox; invites expire after 7 days and can be revoked, to keep that
  window small. `/staff` must be in the project's Redirect URLs allow-list, for this link and
  for the sign-up confirmation link (`emailRedirectTo`).
- **Settings (decided, step 6)**: the café's profile and its seating plan are the café's, so
  they are the owner's — `PATCH /restaurant` and `PATCH /tables/:id` are owner-only, while the
  *reads* are open to any staff member because the currency alone decides how every price on
  their screen is formatted. **Your own account is yours**: `PATCH /me` changes your display
  name and accepts nothing else — a role is not a field there at all, so no login can promote
  itself. A password change never reaches this API: the browser's own Supabase client holds the
  session and changes it directly, so no password is sent to, or logged by, a server we wrote.
- **Creating a café (added, step 7):** signing up creates a Supabase account and nothing
  else, so a person who arrives with no invite waiting belongs to no café. They are offered
  one of their own — `POST /restaurants`, §7 — which is also why that screen replaced the
  dead end that used to tell them to ask an owner. The café is created **after** the email
  round trip rather than before it: with "Confirm email" on, `signUp` returns no session
  until they click the link, so the alternative was parking a form in a table for someone
  who may never come back. Signing up still grants access to **no existing café**; that
  comes only from claiming an invite.
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
- `GET /orders/status` — where each of this guest session's orders is, for the phone to poll
  while the status is on screen **(added, step 8)**. Returns a `stage` per order rather than the
  raw `status`: `awaiting` (placed, not yet accepted — `approved_at`, a separate column, which
  the raw status cannot express), `accepted`, `preparing`, `ready`, `served`, `cancelled`; plus
  the café's `service_mode`. Scoped to the session, never the table, like the bill. Ids, numbers
  and times only — no items, prices or estimate. **Polled, not pushed:** the API's live
  connections are an in-memory hub on one instance for the staff, and a customer phone locks,
  drops and reconnects constantly; a poll of a few indexed rows every 15–30s is cheaper to run
  and to reason about. The phone-side rules (`useOrderStatus.js`): only while a status screen
  is mounted, 15s then 30s after five minutes, paused while the tab is hidden and checked on
  return, stopped once everything is served or cancelled, restarted by Refresh. The request
  passes through `requireGuestSession`, so each poll also renews the session — acceptable
  because polling itself stops when the customer is done
- `GET /bill` — read-only summary of this session's orders: items, notes, per-order and grand
  totals. Cancelled orders are listed but not charged. Scoped to the guest session, never the
  table, so other guests' orders stay private **(added)**
- `POST /orders` — `{ cart_id }` converts that cart into an order. 201 the first time, 200 with the same order on a retry; 409 `items_unavailable` (with the lines) if anything was 86d since it was added. The order lands **unapproved** and waits in the staff approval queue below; the kitchen does not see it yet **(changed, step 6)**

Removed from v1: `GET /orders/:order_id` (customer tracking), `POST /payments`,
`POST /invoices`.

### Private (staff/owner, authenticated + restaurant-scoped)

- `POST /restaurants` — **create a café and become its owner** (step 7). The only route
  here a signed-in person *without* a café may call, and the only write not scoped to a
  café the caller already belongs to: `requireAuthUser` verifies the Supabase token and
  nothing more. The restaurant, the owner's `staff_members` row and the tables asked for
  are created in one transaction — a restaurant with no owner is a café nobody can open,
  and an owner row pointing at nothing is a login that 403s forever. Already linked is a
  409 naming the café they belong to, checked inside that transaction so two taps can't
  both pass. Tables are placed six to a row (the layout migration's own convention) and
  capped at 48, where the 12x8 plan stops holding them; zero is allowed. The response is
  read back out of the rows written, in the shape `GET /me` returns, so the dashboard goes
  straight in **(added, step 7)**
- `GET /me` — the signed-in staff member and their restaurant, **including the café's name**:
  the dashboard's sidebar names the café you are signed in to, and the auth query already
  joins `restaurants` for its `is_active` check, so carrying the name costs nothing and saves
  a request per load **(added; extended, step 6)**
- `PATCH /me` — your own `display_name`, and nothing else. Never a role **(added, step 6)**
- `GET /restaurant` — any staff member; the café's name, address, phone, currency and **service mode** (`table` — staff bring the food — or `counter` — the customer collects it; it changes only the wording of "Ready" on the customer's phone) **(extended, step 8)**
- `PATCH /restaurant` — owner only; partial. `address` and `phone` are clearable (an explicit
  null differs from omitting the field); `name` and `currency_code` are not. The currency is
  normalised to upper case and validated as three letters here, since the column's own check
  only enforces the length **(added, step 6)**
- `GET /orders?status=&table_id=` — order board initial load (active orders + server time). Only approved orders: a QR order the counter hasn't accepted is not the kitchen's problem
- `GET /orders/pending` — the QR approval queue, oldest first, with lines and totals **(added, step 6)**
- `POST /orders/:orderId/approve` — hand a queued order to the kitchen. Locks the row first, so two people accepting at once can't both win; the loser gets a 409 like any lost race. Publishes `order_created` — this is the moment the kitchen hears about it **(added, step 6)**
- `POST /orders/:orderId/reject` — turn one away. Cancels it through the same path as any other cancellation (timeline, actor), and refuses anything that has already left the queue **(added, step 6)**
- `GET /orders/recent` — served/cancelled orders, newest-finished first. Either a rolling
  window (`?hours=`, default 4, up to a week) or one whole **café day** (`?day=today|yesterday`
  with `?tz=`, the same zone contract as `GET /dashboard/summary` — Postgres runs in UTC, where
  the day rolls at 05:30 IST). Sending both is a 400: they are different questions, and a caller
  asking both ways doesn't know which it wants. Each row also carries **who finished it** (the
  actor on the finishing status event) and **how it was paid** (the succeeded payment's method,
  null when nobody has paid yet) — both read off records that already existed, not new schema
  **(added; extended, step 6)**
- `GET /orders/:orderId` — lines, notes, totals and status timeline (who changed it, when) **(added)**
- `PATCH /orders/:orderId/status` — validated against §5; 409 on an illegal or lost-race move. **Also 409 `awaiting_approval` for any move except a cancel on an order the counter hasn't accepted** — approval is what hands an order to the kitchen, so nothing may start one first. Without the guard an order could be started unapproved and then fell out of every screen at once: off the board (approved only), out of the queue (`placed` only), out of the bill (approved only) and so uncheckable, while still keeping its table occupied **(added, after a live incident)**
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
  now confirms against the itemised bill above **(changed, step 6)**. **Step 14:** the checkout now
  runs in one transaction and also creates a **bill** (`bills` + `bill_lines`): a per-café
  consecutive `bill_number` (from `restaurants.bill_counter`), a frozen copy of the lines, totals and
  the café's name/address/phone, and for cash the `amount_tendered` and `change_given` (body field
  `amount_tendered`, refused with 400 if it is less than the total). Each payment row carries
  `bill_id`. The response is `{ settled_order_count, amount, already_settled, bill }`; replaying the
  same idempotency key returns the same bill (200, `already_settled: true`) and burns no number
- `GET /bills/:billId` — front of house; one settled bill with its lines, for a reprint. Another
  café's bill is a 404
- `GET /receipts/:token` — **public, no login** (step 14, phase C): the bill behind the receipt's QR
  code, found by its unguessable `public_token`. Returns the receipt fields only (no ids, no
  token, no kitchen notes), never cached, not indexed; a malformed token is a 404 with no query

### Platform admin (BurpnBill's own area, `/api/admin`)

The one part of the API that reads **across** cafés, so it has its own gate:
`requirePlatformAdmin` accepts a valid login only if its user id is in `platform_admins`
(inserted by hand; no API creates rows). Being a café's owner grants nothing here. A rate limit
runs first (120 a minute per IP). Everything is read-only except recording a payment and
extending a trial, both written to `subscription_events` with who did it.

| Route | What it returns / does |
|---|---|
| `GET /admin/me` | 200 if this login is an admin (the screen asks before showing anything) |
| `GET /admin/overview` | cafés by plan state, trials ending in 7 days, paid plans ending in 14, trials with no orders, money received this month, sign-ups by week |
| `GET /admin/report?month=YYYY-MM` | per café: QR orders, POS orders, order value, **sales** (settled bills), average order, cancelled, last order, and the same figures for the previous month with the % change; plus a total row |
| `GET /admin/restaurants` | the café list: plan, last order, orders and sales in 30 days, team size |
| `GET /admin/restaurants/:id?month=` | one café: profile, plan, figures, a day-by-day series (QR / POS / money taken), payments, plan activity |
| `POST /admin/restaurants/:id/payments` | record money already received `{amount, method, reference?, paid_on?, months?, note?}`; returns the payment (with its invoice number) and the new plan state |
| `POST /admin/restaurants/:id/extend-trial` | `{days}` 1-60 |
| `GET /admin/payments/:id/invoice` | the invoice, read from its frozen snapshot |

Definitions, so the numbers can be argued with: a month is an **IST** month (Asia/Kolkata);
an order counts once it is **accepted** (`approved_at`) and not cancelled; **sales** is the sum of
settled bills in the month (money actually taken) and **order value** is everything accepted,
settled or not; QR vs POS is `orders.source`, written by the API when the order is created.
Money is summed in SQL, and the totals row in whole paise.

**Plan state** is derived, never stored (`planState` in `services/platform.js`): `active` while
`paid_until` is in the future, `trialing` while `trial_ends_at` is, `grace` for 3 days after the
later of the two, then `locked`. **Nothing is enforced yet**: no café is locked or warned; the state is
shown to the admin only. A payment's period starts at the latest of now, the trial's end and the
current plan's end, so paying early loses no trial days and a renewal stacks.

**Payments are recorded by hand** after the money has arrived (UPI or bank transfer). There is no
payment gateway. A payment gets the next invoice number (`BNB-0001`, an identity column) and a
snapshot of the café's and the seller's details (seller from `BILLING_SELLER_*`), so a reprint never
changes. The same transaction reference cannot be recorded twice, against any café.

### Realtime (SSE)

- Custom Server-Sent Events from Express — not Supabase Realtime, not websockets. Data flows
  one way (server → dashboard), and the server already knows about every change because it
  makes them.
- Events in v1: `qr_order_pending`, `order_created`, `order_status_changed`. The board **ignores `qr_order_pending`**: it is for POS's queue, and patching it into the board put an unaccepted order in the New column.
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
- **Frontend**: React (Vite) — one web app for the landing page, customers and staff, no
  native app. Both the staff dashboard (`/staff`) and the **landing page** (`/`) are
  lazy-loaded, so a customer scanning a table downloads neither: verified in a production
  build, where the landing chunk is its own ~6.8 kB JS and ~4.8 kB CSS. The landing page
  is Tailwind on the **dashboard's** language — the BurpnBill brand system, below — because
  its reader is an owner deciding whether to trust this with their service, not a diner.
  Tailwind is imported from `landing/landing-tailwind.css`, reachable only from the landing
  chunk, exactly as `staff/tailwind.css` is for the dashboard **(added, step 7;
  redesigned after owner review)**. The staff
  dashboard (`/staff`) is lazy-loaded, so customers never download it. It signs in with its own
  Supabase Auth client, built from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in a separate
  `web/.env` — never the service-role key, which stays in the server's own `.env` **(decided)**
- **Brand system (added, `feat/brand-system`)**: the landing page, the sign-in and
  create-your-café screens and every dashboard tab wear the BurpnBill brand system — crimson
  `#A70045` for the one primary action, butter `#F4F0A9`, warm ink neutrals on a cream canvas,
  Bricolage Grotesque / Manrope / JetBrains Mono (self-hosted variable fonts), 12/8px radii,
  borders before shadows. It is Tailwind v4 theme tokens in `web/src/brand/tokens.css`
  (`@theme`, no config file), imported only by `staff/tailwind.css` and
  `landing/landing-tailwind.css`, so it ships in those two lazy chunks and **not** in the customer
  bundle (verified in a production build). The wordmark is `brand/Logo.jsx`; order-status colours
  live once in `brand/status.js`. Light only for now. Rules, the four approved logo colourways,
  the old-class → new-token table and the deviations from the brand sheet are in
  `docs/design.md`; `brand/brand.test.jsx` holds them (contrast, no default-palette classes, the
  mark itself). The customer app is deliberately untouched.
- **Customer app styling (changed)**: the customer app (`/t/<token>`) is Tailwind too now, in
  its own lazy chunk (`customer/CustomerApp.jsx`, importing `customer/tailwind.css`) — the same
  scoping the dashboard and landing page use, and for the same reason: Tailwind's preflight is
  global, so it may only load on a route styled for it. Verified in a production build: the
  eagerly loaded stylesheet is ~2 kB with no Tailwind in it. Palette is **white with red as the single accent** (it began as mustard and red; owner
  feedback removed the mustard) — see `docs/design.md`, "The customer app". `styles.css` shrank to what the non-customer routes still reach (the Loading fallbacks
  in `App.jsx`, the staff sign-in's base type, `.veg-mark`).
- **Dashboard styling** *(the teal palette described here is superseded by the brand system above; the
  scoping and cascade-layer reasoning still holds)*: the staff dashboard's sidebar,
  header and POS page are Tailwind CSS v4 (`@tailwindcss/vite`, no config file) plus
  `lucide-react` for icons **(added, step 7)** — a deliberate "premium SaaS" look distinct from
  the customer app's warm palette, per direct owner design feedback. Rules and palette (teal
  accent, chosen specifically to not match reference screenshots' blue — see the doc for why)
  are written up in `docs/design.md`, meant to apply to every tab over time, not just POS. Both
  Tailwind and lucide-react are scoped to the `/staff` lazy chunk only (imported from
  `staff/tailwind.css`, itself only reachable via `StaffApp.jsx`), verified with a production
  build to never reach the customer bundle. The reverse direction is **not** automatic, and bit
  us: `styles.css` loads on every route (it's imported by `main.jsx`), so its global element
  rules also apply to `/staff`. They live in `@layer bnb-customer` for that reason — unlayered
  CSS outranks anything in a cascade layer, and Tailwind v4 puts all its utilities in one, so
  left unlayered the customer reset silently won over every dashboard utility **(added, step 6)**
  **Every tab of the dashboard is now on this system** — Recent was the last one, and the
  `.staff-legacy` wrapper that carried the old plain-CSS dark theme has gone with it, closing a
  seam that had been open since the POS redesign **(completed, step 6)**. What remains of
  `staff.css` is reachable only from the sign-in screen, which renders outside the dashboard
  shell; the rest of that file is now dead and awaits a pruning pass
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
7. **Landing page and self-serve signup** — done, bar real screenshots. `POST /restaurants`
   and the Create your café screen came first (nothing needed retrofitting for
   multi-tenancy: every query already scopes by the caller's own `restaurant_id`, and no
   restaurant id is hardcoded in either `server/src` or `web/src`), then the page at `/`.
   What the page may claim is enforced by a test rather than by convention — no
   trusted-by counts, no price (the pricing section offers a 14-day free trial and says none is set — see TASKS step 10), because there is one café and it is
   the owner's own

After v1: payments, invoices, a richer role set (cashier/waiter, so POS isn't owner-only),
multi-restaurant self-serve signup (see §2).
