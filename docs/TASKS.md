# Pending tasks

What's left for v1, in build order. Scope and decisions: [ARCHITECTURE.md](ARCHITECTURE.md).
Tick items off as they land.

## Housekeeping (do soon)

- [x] **Link your staff login.** Done — linked as `owner` on Chai Point Cafe.
- [ ] **Copy `web/.env.example` to `web/.env`** and fill in `VITE_SUPABASE_URL` /
      `VITE_SUPABASE_ANON_KEY` (same values as the server's own `.env`) so `/staff` can sign in.
      Only needed for a fresh clone/machine — already done here.
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

**Slice 3 — Sign-in and static board** — done
- [x] `/staff` route, lazy-loaded (customers never download this bundle — verified: the string
      "Supabase" appears only in the split-off chunk, not the main one). `web/.env` /
      `web/.env.example`: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` only, kept separate from
      the server's own `.env` — the service-role key never goes near a browser build
- [x] Supabase Auth email + password (`useStaffSession.js`), session persisted by Supabase's own
      client. Being logged in and being LINKED to a café are different things (see Housekeeping) —
      `GET /me` tells them apart; a 403 there shows "not linked", not a broken board
- [x] Three-column board (New / Preparing / Ready); card = order number, table, items + notes;
      one-tap forward button showing only the single legal next status (`staff/transitions.js`
      mirrors the server's `ORDER_TRANSITIONS` — comment linking them so they don't drift);
      Cancel asks for confirmation (`window.confirm` — no undo once sent, per the state machine)
- [x] A 409 (lost race / stale view) shows who got there first, then resyncs the board — same
      idea planned for slices 4/5, built now since `PATCH /status` already returns it
- [x] Tablet/desktop layout (three columns; stacks to one on a narrow screen)
- [x] Tests: real dashboard -> real API -> real Postgres, with only the Supabase Auth CLIENT
      faked (`createFakeAuth` in the test file) — its token still has to satisfy the server's own
      fake verifier (shared `web/src/test/globalSetup.js`, now seeded with a linked staff login),
      so both fakes agree on one convention rather than diverging. Sign-in, wrong password,
      not-linked, real placed orders shown and moved, cancel-with-confirm, and the lost-race path
      — mutation-checked (column filtering, conflict-message branch) and confirmed for real
- [x] Live-checked against real Supabase in the browser: the sign-in form renders with real
      config, and a genuine wrong-password attempt round-trips to Supabase and displays "Invalid
      login credentials" — the same message the fake tests already cover. A full successful
      sign-in still needs your real password (not tested here)
- [x] Found and fixed before it shipped: the production Supabase client was being constructed at
      module load time, so a missing/misconfigured env var would have blanked the page with an
      uncaught error the instant `/staff` loaded, instead of a normal message

**Slice 4 — Going live** — done
- [x] `useOrderStream.js`: opens `GET /orders/stream` with `fetch` (never `EventSource`, see slice 2)
      and reconnects with exponential backoff (1s → 15s cap) on any drop; `sse.js` parses the raw
      SSE frames by hand for the same reason
- [x] `useBoard.js` patches a pushed order straight into local state (`applyBoardEvent`) instead of
      refetching per-event — a full `GET /orders` only runs on the initial load, after an action
      THIS tab took, and after a reconnect (a gap may have missed events)
- [x] `age.js`: `skewFromServerTime` — `server_time` (already in `GET /orders`, slice 1) minus the
      device's own clock, so a kitchen tablet with a wrong clock still shows correct ages
- [x] "Live / Reconnecting…" indicator in the header — never fails silently; a dropped connection
      is always visible, not just invisible until someone notices orders stopped moving
- [x] New-order sound (`chime.js`, Web Audio, no audio file) behind a real "Turn on sound" click —
      browsers block audio without one; flashing tab title with the count
      (`useNewOrderAlerts.js`), both clearing themselves the moment the tab is looked at again
- [x] Stuck highlight: amber at 5 min, red at 10 min, using the server-corrected clock; each card
      ticks its own age independently (`useNowTick.js`) rather than re-rendering the whole board
- [x] Tests: a live push updates an already-open dashboard with zero clicks; a genuinely dropped
      connection (not a mocked status flag) recovers and resyncs an order placed during the gap;
      sound arms without replaying old orders; tab title sets/clears; stuck highlight from
      server-corrected age, independent of the test machine's own clock. Mutation-checked (live
      patching, reconnect retry, stuck threshold) — all three caught; 6 clean repeat runs, no flake
- [x] Fixed along the way: the ORIGINAL "lost race" test from slice 3 became unreliable once the
      board was actually live — the competing "other device" call's own push now reaches the same
      dashboard almost instantly, so the UI's stale button could vanish before the test could
      click it. Fixed by moving the order out-of-band (raw SQL, bypassing the API) for that one
      test, so it stays genuinely stale, and added a SEPARATE test for the live-push path itself

**Slice 5 — Detail and Recent** — done (frontend only; `GET /orders/:id` and
`GET /orders/recent` already existed from slice 1)
- [x] Order detail drawer (`OrderDetailDrawer.jsx`, native `<dialog>` again): items with price and
      notes, subtotal/tax/total, and the full status timeline (who moved it, when). Opens from
      either the live board (click an order's number) or a Recent row
- [x] Recent tab (`RecentOrders.jsx` + `useRecentOrders.js`): served/cancelled, last 4 hours, a
      manual Refresh rather than its own SSE connection — one more live stream per staff session
      for a screen nobody watches continuously wasn't worth it
- [x] `Board.jsx` now owns a Board/Recent tab switcher and the drawer's open/closed order id;
      the 3-column view moved to its own `ActiveColumns.jsx`
- [x] Tests: opening a live order's detail shows its items/total/timeline; the Recent tab lists
      served and cancelled orders with the right status pill, and opening one shows every staff
      member who touched it, correctly attributed; Recent's own Refresh is independent of the
      live board. Mutation-checked (timeline attribution, tab switching), both caught
- [x] **Found and fixed a real, latent test-infrastructure bug** while chasing an apparent flake:
      Vitest runs test files in parallel by default, and both web test files share one database
      via `globalSetup` — a customer-app test counting *all* orders could occasionally see ones a
      concurrently-running staff test had just placed. Fixed with `fileParallelism: false` in
      `vite.config.js`; confirmed with 5 clean repeat runs. This likely explains one-off failures
      seen in earlier slices that were wrongly chalked up to plain CPU contention at the time.

## Step 5 — Owner admin panel

**Decided:** no photos in v1 (the `image_url` column stays, unused, for later) · admin lives as
new owner-only tabs in the existing `/staff` dashboard, not a separate route · renaming/pausing
an existing table stays deferred (already on the "after v1" list below).

**Slice 1 — Menu API** — done
- [x] `GET /items` — admin list: every live item including 86'd ones, never a deleted one
- [x] `POST /items` — owner only; name + price required, everything else optional with sane
      defaults (category "Uncategorised", available, no veg flag)
- [x] `PATCH /items/:id` — owner only, partial update: an omitted field keeps its value, an
      explicit `null` clears `description`/`is_veg` — the two are deliberately different
- [x] `DELETE /items/:id` — owner only, soft delete; idempotent (deleting twice is a 404, not a
      crash); a soft-deleted item never rewrites a past order's own name/price snapshot
- [x] `PATCH /items/:id/availability` — owner **and** staff, matching the original security model
      ("the kitchen can 86 an item mid-service")
- [x] Tests on real Postgres: café scoping, validation, partial-update field preservation,
      soft-delete leaving order history untouched, and a toggled-off item actually disappearing
      from the real customer menu and being rejected from a cart in the same request cycle.
      Mutation-checked (restaurant scoping, field-preservation logic), both caught
- [x] Live-checked against Supabase inside a rolled-back transaction: create, partial update
      with a cleared field, availability toggle, delete — nothing persisted after

**Slice 2 — Tables API** — done
- [x] `GET /tables` — staff and owner; label, seats, qr_token, is_active, oldest first (a new
      table lands at the bottom rather than reshuffling ones already printed)
- [x] `POST /tables` — owner only; `qr_token` generated by the database's own default
      (`generate_opaque_token()`), never invented by the API. A duplicate label within one café
      is a 409 via the schema's own unique constraint — no special-casing needed
- [x] Tests on real Postgres: café scoping, opaque/unique tokens (never the raw label), owner-only
      + input validation, a new table's QR token resolving to a real working menu immediately,
      duplicate-label rejection (same label at a *different* café is fine). Mutation-checked
      (restaurant scoping on the list), caught
- [x] Live-checked against Supabase inside a rolled-back transaction: create, duplicate-label
      rejection, nothing persisted after
- [x] `notImplemented` import removed from `staff.js` — every route stub in that file is now real

**Slice 3 — Menu tab in the dashboard** — done
- [x] Owner: add/edit item (`ItemForm.jsx`, one form for both — editing always sends every field,
      a full replace rather than exposing the API's partial-update as a UI concept) and delete,
      with the same inline confirmation pattern as Cancel (not `window.confirm` — same
      button-label-collision problem it would reintroduce)
- [x] Staff: the identical list, availability toggle only — no add/edit/delete controls rendered
      at all for them, not just disabled
- [x] `useMenuAdmin.js`: no live push (menu edits are infrequent, made by whoever's looking at
      this exact screen) — a refetch after every action is enough
- [x] Tests: role-based visibility (owner vs. staff), toggling availability from here reaching the
      real customer menu immediately, add/edit reaching the real customer menu, delete via the
      inline confirm (not a native popup) with "Keep it" changing nothing. Mutation-checked
      (role gate on the toolbar, the delete confirmation step), both caught
- [x] **Found and fixed two more vacuous tests** while mutation-checking (same class of bug as
      step 4's `fileParallelism` investigation): a negative assertion (`not.toBeInTheDocument()`)
      run before the screen had actually finished its own async load passes trivially either way,
      since nothing relevant has rendered yet regardless of the code being right or wrong. One was
      in this slice's own new test; the other was **latent in a slice-4 Recent-tab test**, only
      surfaced now by deliberately mutation-testing something unrelated in its neighbourhood.
      Fixed both by waiting for real, loaded content before asserting an absence

**Slice 4 — Tables tab** — done
- [x] Owner only (the whole tab is hidden from staff, not just its add control — unlike Menu,
      staff have no reduced-view need here). `TablesTab.jsx`: add a table (`TableForm.jsx`, label
      + optional seats; no edit/delete yet, both on the "after v1" list) and a QR card per table
      (label, seats, QR code, the printable `{origin}/t/{qr_token}` URL as text)
- [x] QR codes rendered client-side with the `qrcode` package's pure-JS SVG string renderer (not
      its canvas renderer — canvas needs a real `<canvas>` 2D context, which jsdom doesn't provide
      without the native `canvas` package; SVG needs none, in tests or in a real browser), wrapped
      as a `data:image/svg+xml;base64,` URL so it drops into a plain `<img>`. No server-side image
      generation, per the original decision
- [x] "Print QR sheet" uses the browser's own Print / Save-as-PDF (`window.print()`); `@media
      print` in `staff.css` hides the dashboard chrome (header, tabs, toolbar) and leaves just the
      QR cards, two per row, each `break-inside: avoid`
- [x] `useTablesAdmin.js` mirrors `useMenuAdmin.js` (no live push — table changes are as
      infrequent as menu edits, made by whoever's on this exact screen)
- [x] Tests: owner sees the Tables tab, staff don't; the seeded tables list with their QR image
      and printable URL; adding a table reaches the real API and its QR token resolves to a real,
      working menu; a duplicate label surfaces the server's error inline, dialog stays open.
      Mutation-checked (owner-only tab gating, the create call actually persisting, the QR URL
      actually encoding the right token, the duplicate-label error actually surfacing) — all four
      caught
- [x] Live-checked in the browser: `/staff` (lazy-loaded chunk) loads cleanly with the new
      `qrcode` dependency bundled in, no console errors. A full sign-in as owner to see the Tables
      tab rendered for real still needs your actual password — same limit as every other
      staff-side slice; not tested here

## Step 6 — Owner operations dashboard

**Decided:** still 2 roles (owner/staff) — no 5-role expansion this round. That means POS,
Dashboard and Staff management are **owner only**; there's no cashier/waiter role to hand
day-to-day POS use to yet, only the owner can ring up a walk-in. Kitchen staff keep exactly
today's experience (Board/Recent/Menu-toggle) and never see the new tabs. No new restaurant
signup this round — still the one demo café (Chai Point Cafe); a real "create your
restaurant" flow becomes its own step later, alongside the landing page. POS orders are
dine-in only for now (pick an existing table) — no take-away/no-table orders yet, that's a
real gap but a separate piece of work. Dashboard shows today's snapshot only (revenue,
active orders, table status) — no historical reports yet, that's its own later step too.

**Design pivot, mid-step-7 (slice 3):** the plain-CSS dark neutral theme from slice 1 was
replaced by a Tailwind CSS ("premium SaaS" reference brief: white/off-white base, one indigo
accent, soft pastel status badges) sidebar + header + POS, per direct owner feedback that the
dark theme "didn't look premium." **Tailwind v4** (`@tailwindcss/vite`, no `tailwind.config.js`
— v4's zero-config default, which also happens to match the brief's "default utility classes
only" constraint) plus `lucide-react` for icons, both scoped to the `/staff` lazy chunk only
(imported from `staff/tailwind.css`, itself only imported by `StaffApp.jsx` — same trick
`staff.css` already used). Verified with a production build: the main customer bundle's CSS/JS
have zero occurrences of `indigo`, `lucide`, or `.staff-app` — customers still never download
any of this. **Known, temporary visual seam**: Board/Recent/Menu/Tables/the Dashboard and Staff
placeholders still use the old dark theme (now scoped to `.staff-legacy` instead of `.staff-app`,
since `.staff-app` itself is now a plain Tailwind flex container) — light chrome, dark legacy
pages, until those are migrated too. Not solved today; flagged to the owner rather than
silently left inconsistent.

**Slice 1 — Shell: sidebar nav + three new owner-only tabs** — done (sidebar later rebuilt
in Tailwind during slice 3 — see the design pivot note above; this slice's tab state/ids/
content-routing decisions are what survived)
- [x] Kept the same tab state/ids/content-routing in `Board.jsx` (`OWNER_TABS`) that added
      the Tables tab in step 5 — nearly every existing test signs in as the `owner`-role
      fixture to exercise the board, so changing *what* renders per tab risked rewriting most
      of the suite. What changed is purely the chrome around it: the tab buttons moved from a
      horizontal top bar into a sidebar (brand mark, vertical nav, identity footer at the
      bottom), matching the reference layout the owner asked for. Same buttons, same
      accessible names, same content per tab — just relaid out — so every existing test kept
      passing with zero changes needed to the tests themselves. (The original version of this
      sidebar was plain CSS, dark-themed, matching slice 1's own now-superseded design
      decision — see the pivot note above for what replaced it)
- [x] `DashboardHome.jsx`, `POS.jsx`, `StaffTab.jsx` — placeholder components ("Coming
      soon"), owner-only tabs, real content lands in slices 4, 2-3, and 5 respectively
- [x] Tests: owner sees all three new tabs, staff see none of them, each placeholder renders
      its own distinct content. Mutation-checked (owner-only gating, tab-to-content routing),
      both caught
- [x] Live-checked: a throwaway static HTML page against the real `staff.css` (deleted after
      each check, never committed) — first confirmed all 7 tabs fit the tablet/desktop
      sidebar without wrapping, then again after the sidebar layout to confirm the mobile
      fallback genuinely collapses to a horizontal bar (caught one build issue: the scratch
      page itself was missing a viewport meta tag, made the mobile emulation render at a
      desktop-width 980px instead of 375px — the real app's `index.html` already has this
      tag, so this only ever affected the scratch page, not the app)

**Slice 2 — Floor map** — done
- [x] `GET /floor` — owner only: every table plus whether it's occupied, derived from active
      orders (`status in ('placed','preparing','ready')`) via a `left join lateral` against
      `orders` — no new schema. `server/src/services/floor.js`
- [x] Floor map view inside `POS.jsx`: tables as cards, green "free" / red "occupied" soft
      badges, selected table gets a teal ring
- [x] Tests: every table's occupancy reflects its real active order (or lack of one), a
      cancelled order frees the table again, café-scoped. Mutation-checked (the free/occupied
      derivation itself), caught

**Slice 3 — POS order entry** — done
- [x] Tap a table on the floor map → search/filter the live menu → build a cart → "Send to
      kitchen". Switching tables discards the in-progress cart on purpose (never sent
      anywhere until confirmed, and carrying table A's half-built order onto table B by
      accident would be a real mistake on a busy floor)
- [x] `POST /staff/orders` `{ table_id, items: [...] }` — owner only; same guarantees as the
      customer checkout path: items locked `for share` so an availability toggle mid-request
      waits, prices copied from the menu not the client, total summed in SQL not JS. Writes
      straight to `orders`/`order_items` — no customer cart involved, but `orders.
      guest_session_id` is `not null` with a real FK, so each POS order gets its own
      throwaway `guest_session` scoped to the table (never returned to any client, no
      customer ever sees it) purely so it fits the same shape every other order already has.
      Publishes the same `order_created` SSE event as a QR order — the kitchen board doesn't
      know or care which path an order came from
- [x] `orders.source` column (`qr` | `pos`) — **not added**; deferred until an actual later
      step (Reports) needs to break sales down by source, rather than speculatively
- [x] Tests (server): validates the body, a made-up/inactive/other-café's table is 404,
      another café's menu items can't be ordered onto your table, an 86'd item is rejected
      with nothing written (the whole request rolls back), the timeline records which owner
      placed it (unlike a customer QR order, which has no staff actor). Mutation-checked
      (the availability check, restaurant-scoping on the table lookup), both caught
- [x] Tests (web): floor map reflects real occupancy, selecting a table + adding items +
      sending to kitchen creates a real order that appears on the live kitchen board exactly
      like a QR order would, switching tables clears the cart, the send button's disabled
      state, search/category filtering. Mutation-checked (cart-reset-on-switch, the
      send-button's disabled condition), both caught. One real test bug found and fixed along
      the way: an `await screen.findByText(...)).not.toBeInTheDocument()` construction is
      backwards — `findByText` itself throws if the text never appears, so a negative
      assertion needs `queryByText` instead; same class of vacuous-negative-assertion bug
      flagged in step 5's own retrospective, still worth watching for
- [x] Live-checked: a throwaway static HTML page against the real, compiled Tailwind output
      (deleted after) to confirm the floor/menu/cart layout actually renders as intended —
      full sign-in still needs the owner's real password, same limit as every other
      staff-side check in this project

**Slice 3 follow-up — owner feedback after first look** — done
- [x] `docs/design.md` — a design system doc so every future tab follows the same rules
      (color, type, shape, layout) instead of each slice inventing its own. Also states the
      "structure, not screenshots" rule explicitly: take inspiration from a reference's
      *pattern* (sidebar + cards + a contextual panel), never its literal colors or layout
- [x] Primary accent switched from indigo to **teal** — indigo/blue is what most POS
      references (including the one we looked at) already use as their primary; teal reads as
      premium the same way without being the same choice
- [x] Floor map cards: a soft red/green tint + border now, not just the small badge — "make it
      red when busy, green when available" was about the whole card reading at a glance, not
      just a small pill
- [x] **Occupied now means "unpaid", not "the kitchen has work to do"**: `getFloor` no longer
      restricts to `placed/preparing/ready` — a table stays occupied through `served` too
      (the group is very likely still sitting there), and only frees up on checkout or if every
      order on it is cancelled
- [x] `POST /tables/:tableId/checkout` — owner only; a manual stand-in since there's no
      payments feature yet (see ARCHITECTURE.md §2): marks the table's `served`, unpaid
      orders as paid (`orders.paid_at`, the same column a real payment will eventually set).
      Deliberately restricted to `served` orders — marking a still-cooking order "paid" out
      from under the kitchen would be a footgun, not a shortcut. Surfaced as a "Checkout"
      button on a table's floor card, shown only when it would actually do something. A fuller
      itemised bill/checkout screen (in the Orders/Recent area) is still deferred, per the
      owner's own framing — this is the smallest thing that makes "occupied until checkout"
      true today, not the final feature
- [x] "Tables" heading in POS renamed to "Floor" — the sidebar's own "Tables" tab (QR code
      management) is a different feature and keeps its name; only POS's internal floor-map
      section changed
- [x] Veg/non-veg dot added to POS item cards (`VegMark`, reused from the customer app) —
      food-safety information, not decoration; considered and declined general decorative
      coloring of item cards, which would cut against the brief's own "clarity beats
      decoration" principle for a grid of 20-30 cards — see design.md
- [x] Tests: served-but-unpaid still shows occupied, checkout frees the table and marks the
      order paid, checkout leaves a still-cooking order untouched (stays occupied), the
      Checkout button only appears once the order is actually served, the veg mark renders.
      Mutation-checked (checkout's `status = 'served'` restriction, the Checkout button's
      visibility condition, the veg mark itself), all three caught
- [x] Live-checked: same throwaway-static-page technique against the real compiled Tailwind
      output, confirming the teal accent, stronger red/green cards, Floor heading, Checkout
      button and veg dots all render as intended

**Slice 4 — Dashboard home** — not started
- [ ] `GET /dashboard/summary`: today's revenue (sum of non-cancelled orders' totals),
      active order count, table free/occupied counts — reuses the floor endpoint's data
- [ ] Replaces the `DashboardHome.jsx` placeholder

**Slice 5 — Staff management** — not started
- [ ] `POST /staff/invite` `{ email, display_name, role }` — owner only; calls Supabase
      Admin's `inviteUserByEmail` (service-role key, server-side only) to create the auth
      user and send the invite email, then creates the `staff_members` row immediately with
      the chosen role (matches the reference screenshot's inline role picker on the invite
      form itself, rather than waiting for the invitee to complete signup)
- [ ] **Known risk to flag before relying on this**: Supabase's default email sending is
      low-volume/rate-limited without custom SMTP configured — invite emails may not land
      reliably until that's set up
- [ ] `PATCH /staff/:id` (change role), `DELETE /staff/:id` (removes the `staff_members` row
      only — unlinks them from this café, does not delete their Supabase Auth account, since
      that identity might be used elsewhere)
- [ ] Replaces the `StaffTab.jsx` placeholder: invite form + active staff list with an
      inline role dropdown and a remove action

## Step 7 — Landing page

- [ ] Built last, with real screenshots of the working flow
- [ ] Real "create your restaurant" signup (name, owner name, email) likely belongs here too,
      alongside the landing page, rather than as part of step 6 (see step 6's "Decided" note)

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
