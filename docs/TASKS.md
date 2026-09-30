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
an existing table stays deferred (already on the "after v1" list below). *Both of those were
superseded in step 6: photos landed in slice 7, renaming and pausing in slice 8.*

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

**Slice 3 follow-up 2 — readability fix + reference pass** — done
- [x] **A real bug, found by the owner on a Mac: most of the dashboard's text was invisible.**
      Same build — fine on Windows, unreadable in both Safari and Brave on macOS. Took three
      diagnoses; the first two were wrong and are recorded here so nobody re-runs them:
      (1) Tailwind v4's oklch palette rendering differently on macOS — disproved by pinning
      every colour to explicit sRGB hex and seeing zero change; reverted rather than left in as
      a cargo-culted no-op. (2) macOS grayscale antialiasing rendering text thinner than
      Windows' ClearType — plausible, but it doesn't explain faint *icons* or serif headings.
      **Real cause: a cascade-layer conflict.** `web/src/styles.css` is the customer app's
      stylesheet but `main.jsx` loads it on every route including `/staff`, and its global
      element resets were unlayered. Unlayered CSS outranks anything in a cascade layer
      regardless of specificity, and Tailwind v4 puts every utility in one — so
      `button { color: inherit }` beat every `text-*` class on the dashboard and each button
      inherited the *customer* palette's body colour, which is near-white under
      `prefers-color-scheme: dark`. The owner's Mac is in dark mode; the Windows machine was
      in light mode. That's the entire OS difference. `h1, h2 { font: … Fraunces }` beat the
      heading utilities the same way, which is why page titles rendered serif
- [x] Fix: those element rules now live in `@layer petuk-customer` — a no-op for the customer
      app (nothing there is layered) that lets the dashboard's utilities win. Class rules in
      that file stay unlayered deliberately, since `.veg-mark` is shared with the dashboard.
      Plus `.staff-app :is(h1,h2,h3) { font-family: inherit }` in `tailwind.css`, because
      Tailwind has no font-family utility on headings to override Fraunces with
- [x] Reproduced the bug first and verified the fix after, both in the browser with
      `prefers-color-scheme: dark` emulated and both real compiled stylesheets loaded in the
      app's own order — invisible nav + serif headings before, correct after, and the customer
      app confirmed unchanged in light and dark
- [x] design.md updated: `text-gray-500` is now the lightest text allowed (and only on a tinted
      background), `font-semibold` is the floor weight for small or gray text, and the cascade
      trap is written up with the rule "global element styles in styles.css go in that layer"
- [x] Sidebar/header/POS rebuilt against a second owner reference ("DineFlow"), per design.md's
      "structure, not screenshots" rule — solid-filled active nav, brand monogram, floor count
      strip, table cards showing the live order number + how long it's been occupied, item-card
      monograms, filled cart header, boxed total. Deliberately **not** taken: its blue, its
      per-category card tints, and its features Petuk doesn't have (Waitlist, Merge Tables,
      Clock In, take-away, priority, VIP, itemised bill, Inventory/Customers/Reports) — drawing
      UI for features that don't exist would fake capability. The full take/don't-take record is
      in design.md
- [x] Tests: all 54 web tests pass. Two needed updating, both for the same deliberate copy
      change (the cart's empty state became a bold line + a supporting line instead of one
      sentence); the assertion still discriminates the same state. Mutation-checked that the
      updated assertion isn't vacuous — broke `selectTable`'s cart reset in `usePOS.js`, confirmed
      "switching tables discards the in-progress cart" fails, reverted
- [x] Live-checked with the usual throwaway static page against the real compiled Tailwind
      output (deleted after, never committed) — full sign-in still needs the owner's password
- [ ] **Still to do**: the floor cards show order number + age but not the table's running
      total (the reference does). `GET /floor` doesn't select `orders.total` yet — a one-line
      SQL change plus a test, deliberately not bundled into a UI-only change
- [ ] **Still open, and now more visible**: Board/Recent/Menu/Tables and the two placeholders are
      still the old dark theme, so the contrast fix and this whole visual language stop at the
      chrome. Migrating them is the obvious next design task

**Slice 3 follow-up 3 — table bill & checkout** — done
*Owner brought a second POS reference ("DineFlow") showing a busy table carrying its bill, a
Cart/Ongoing split, and a checkout screen. Taken as structure, not feature-for-feature — see
design.md's worked example for what was deliberately left out.*
- [x] **No payment gateway, and that's the point.** The counter takes cash/card/UPI exactly as
      it does today; checkout *records which* and marks the orders paid. `payments.method` was
      already a `cash|card|upi` enum and `payments_sync_order_paid_at` already set
      `orders.paid_at` — this uses the schema as designed rather than inventing a parallel one.
      `provider_ref` stays null, reserved for a real gateway later
- [x] `GET /floor` now carries `unpaid_total` / `unpaid_count` (summed over **every** unpaid
      order, not just the newest) and `qr_token`, so a floor card shows what the table owes and
      the QR tab needs no second request
- [x] `GET /tables/:tableId/bill` — the staff-side table bill: every unpaid non-cancelled order
      with its lines and totals. This is the "Table-level bill on the staff side" item from the
      After-v1 list, brought forward because checkout needs something to confirm against
- [x] `POST /tables/:tableId/checkout` now takes `{ method, idempotency_key }` and writes a real
      payments row per order. The key is suffixed per order so one checkout of a multi-order
      table still satisfies the unique index, and a replayed key is a no-op — a double-tapped
      Confirm settles once. Orders are locked `for update` first, same pattern as
      `PATCH /orders/:id/status`
- [x] **Deliberate behaviour change, flagged:** checkout no longer refuses orders that aren't
      `served` yet. Paying before the food lands is normal; the old restriction existed because
      checkout was then a blind one-tap button, and the cashier now confirms against an itemised
      bill. An order's kitchen status is untouched by payment — a test asserts a `preparing`
      order stays `preparing` after being paid
- [x] POS UI: floor cards show the running bill + age + order count; Floor/QR tabs (QR reuses
      the Tables tab's generator, extracted to `staff/qr.js`); Cart/Ongoing tabs on the order
      panel; an amber "N unpaid orders · running total" notice; a "Bill & checkout · ₹X" CTA;
      and `CheckoutDialog.jsx` — itemised bill, Cash/Card/UPI, amount tendered with change due
      for cash, Confirm
- [x] Tests: 114 server (was 107) + 54 web. New server coverage for the running bill, the
      payment row's method/amount/null provider_ref, idempotent replay, settling every unpaid
      round, a still-cooking order being settled without moving its status, rejecting a method
      that isn't on offer and a table with nothing outstanding, and the bill's contents/scoping.
      New web coverage for the full checkout flow through to asserting the recorded method.
      Mutation-checked: per-order idempotency suffix, the served-only restriction, the
      running-bill aggregate, the dialog's method choice, and the dialog's line items — all caught
- [x] **Found a real bug during the dark-mode visual check**: `<dialog>` with no background of
      its own falls back to the UA's `canvas` colour, which is dark under
      `prefers-color-scheme: dark`, so the checkout panel's gray text sat on near-black. Same
      family as the cascade bug above. Fixed by making the dialog declare `bg-white text-gray-900`
- [ ] **Not built, deliberately** (each its own piece of work, no schema today): discount, tip /
      service charge, split bill, partial payment, tax. Waitlist likewise — it's a whole feature,
      not a tab

**Slice 3 follow-up 4 — checkout polish** — done
*Owner's screenshots of the same reference's checkout / full-screen / payment-complete screens.*
- [x] **Bug: the checkout panel opened against the top-left edge, not centred.** Tailwind's
      preflight sets `margin: 0` on every element, which overrides the `margin: auto` the browser
      uses to centre a `showModal()` dialog. Fixed with `m-auto`; written up in design.md next to
      the dark-`<dialog>` trap, since both are the same "the reset took something the UA gave us
      for free" shape
- [x] Items are grouped by round (`Round 1 · #1041`) with a "N orders merged" badge on the
      header, instead of one flat list — a table that ordered twice can see which round a line
      came from. The data was already there; `GET /tables/:id/bill` returns per-order items
- [x] Subtotal / Total shown above the CTA. **Tax is rendered only when non-zero** — it's always
      0 today (no tax engine) and a permanent `₹0.00` row would imply one exists
- [x] Full-screen toggle: the same dialog re-laid out as two columns across the whole viewport,
      for a counter screen rather than a laptop
- [x] Payment-complete state replaces "close the dialog on success": amount, method, table and
      time, with Print receipt and Done. Closing on success flashed the amount away exactly when
      someone wants to read it back to the customer, so `usePOS.checkoutTable` now returns a
      receipt and the cashier dismisses it
- [x] Print receipt renders through a portal to `<body>`, not from inside the dialog — a modal
      lives in the browser's top layer, which browsers print inconsistently. `@media print`
      hides `#root` and shows only the receipt
- [x] No Wallet button (the schema's `payment_method` enum has no such value — a method that
      can't be recorded is a lie), no customer name/phone (no customers table)
- [x] Tests: 55 web (was 54). New coverage for two rounds merging into one grouped bill, and for
      the receipt screen showing the amount and method before Done closes it. Mutation-checked
      (round grouping, receipt-instead-of-close) — both caught
- [ ] **Unverified:** the printed output itself. `window.print()` can't be driven or inspected
      through the tooling here, so the print stylesheet is reasoned-about, not seen — worth one
      manual Print receipt before relying on it

**Slice 3 follow-up 5 — QR order approval queue** — done
*A QR order used to go straight to the kitchen board. It now waits at the counter until staff
accept it, per the owner's reference POS.*
- [x] **Migration `20260926120000_qr_order_approval.sql` — needs applying to Supabase.** Adds
      `orders.approved_at` (nullable) and a partial index for the queue, and backfills every
      existing order from its `placed_at` (they're all already cooking or paid for)
- [x] **Modelled as a column, not a new `order_status` value.** A new enum member would mean
      rewriting the status state-machine trigger everything depends on, on a live database, and
      revisiting every `status in (...)` query. A nullable timestamp composes with that machine
      instead of changing it: an order's status lifecycle is exactly what it was, it simply
      isn't shown to the kitchen until accepted
- [x] `GET /orders` (the board) filters on `approved_at is not null`; `POST /staff/orders`
      (POS) sets it at creation — the person placing it is the person who'd approve it
- [x] `GET /orders/pending`, `POST /orders/:id/approve`, `POST /orders/:id/reject`. Approve locks
      the row first so two people accepting at once can't both win (409 to the loser, same shape
      as a lost status race) and does **not** touch `status`. Reject cancels through the normal
      `updateOrderStatus` path, so the timeline records who, and refuses anything that has
      already left the queue — cancelling a cooking order still goes through the board
- [x] SSE: a QR order now publishes `qr_order_pending` (the queue), and `order_created` fires on
      approval — so the kitchen board hears about an order at the moment it becomes the
      kitchen's problem, not before
- [x] Money: an unapproved order is excluded from the table bill, the floor's running total, and
      checkout — nobody owes for an order the counter hasn't accepted. Occupancy still counts it:
      the guests are sitting there either way
- [x] POS's **QR tab is now the queue** (with the waiting count on the tab), matching the
      reference. The printable QR *codes* stay in the Tables tab where they already lived; the
      short-lived QR-codes panel added in the previous slice is gone, and `staff/qr.js` remains
      because TablesTab still uses it
- [x] POS opens its own SSE connection for this, unlike Recent. An order sitting unnoticed in the
      queue is the one failure this feature must not have, given it replaces straight-to-kitchen
- [x] Tests: 121 server (was 115) + 57 web (was 55). Both suites' order helpers now approve
      out-of-band so board tests stay about the board, with the queue covered by its own tests.
      Mutation-checked five ways — board approval filter, reject's still-queued guard, POS orders
      skipping the queue, the Approve button, and Reject calling the right endpoint — all caught
- [ ] **Known gap, and the reason to look at roles soon:** the queue lives in POS, which is
      owner-only, so today only the owner can accept a QR order — if they're not at the till,
      orders wait. The API deliberately allows **staff** too, so surfacing the queue on the Board
      (which staff can see) is a small follow-up and probably the next thing to do

**Slice 6 — Kitchen display: the order board on the new design system** — done
*The owner's reference was a kitchen display screen; this is also the legacy-theme migration
that had been flagged since slice 3.*
- [x] `ActiveColumns.jsx` and `OrderCard.jsx` rebuilt in Tailwind. **Every behaviour kept**: only
      the single legal next status is offered (`transitions.js`), Cancel still confirms inline
      rather than via `window.confirm`, live SSE patching, server-corrected ages, per-card ticking
- [x] Columns are white panels with an accent bar and a count: **New = amber** (waiting),
      **Preparing = teal**, **Ready = emerald**. That is finally a real use for the amber the
      status palette had reserved — and deliberately not the reference's blue/orange
- [x] Cards lead with the **table**, which is what a kitchen calls out; the order number below
      is the link into the detail drawer. The forward button is coloured by where the order is
      *going*, is full-width and uppercase, and presses in (`active:scale-[0.98]`) for tablets
- [x] Stuck orders now ring the whole card (amber 5 min, red 10 min) instead of only tinting the
      age — it has to read from across a kitchen
- [x] Responsive: three independently-scrolling columns at `lg`, stacking to one scrolling page
      on a phone. Checked at 1400px and 390px
- [x] `OrderDetailDrawer.jsx` migrated too — it opens *from* the board, and a dark drawer over a
      light board was the whole reason to keep going. Needed `ml-auto mr-0 my-0` for the same
      preflight reason the checkout dialog needed `m-auto`
- [x] Two brittle test hooks replaced while migrating: the stuck assertion used the CSS class
      `staff-card-danger` (now `data-stuck="danger"`, a deliberate hook rather than a styling
      class), and the drawer test queried `.staff-status-pill` (now asserts the drawer's own
      heading, which is also where a reader looks)
- [x] Tests: 66 web, all passing. Mutation-checked three ways — the stuck threshold, column
      filtering by status, and "Keep order" not cancelling — all caught
- [ ] **Deliberately not taken from the reference**: order priority (LOW/NORMAL/HIGH/VIP) and
      VIP flags have no schema, and "Avg prep: 6m" needs history this screen doesn't load. A
      columns/grid view toggle was skipped too — the responsive layout already does that job
- [ ] **Still legacy dark**: Recent, Menu, Tables, and the Dashboard placeholder. `Board.jsx`'s
      `['board', 'pos', 'staff']` list is what decides; remove a tab from it as it's migrated

**Slice 4 — Dashboard home** — done
- [x] `GET /dashboard/summary?tz=` — owner only. No new schema; everything is derived from
      orders, tables and the menu as they already are
- [x] **"Today" is the café's day, not the database's.** Postgres runs in UTC, where the day
      rolls over at 05:30 IST — halfway through a morning shift, which would have split a
      day's takings in two. The browser passes its IANA zone and the boundary is computed in
      it, resolved against `pg_timezone_names` with a UTC fallback so a nonsense value degrades
      instead of erroring. No timezone column needed on `restaurants`
- [x] **Takings and what's owed are separate numbers**, not one "revenue" figure: one is in the
      till, the other is sitting on tables. A single total would be a number nobody could act on
- [x] Also: order/cancellation counts, average order value, the live kitchen queue *including*
      the QR approval backlog, table occupancy on the floor map's own definition (so the two
      screens can't disagree), average **kitchen-to-ready** time — measured from the `preparing`
      event, so it's the kitchen's time and not time spent waiting to be accepted — today's best
      sellers, 86'd item count and team size
- [x] **Averages are `null`, never 0, when nothing has happened yet** — zero minutes reads as
      "instant" and zero average order reads as "worthless tickets". The UI renders those as "—"
- [x] `DashboardHome.jsx` replaces the placeholder: white tiles with dark numbers and colour
      only where it means something (money owed, a queue waiting, a cancellation). Deliberately
      *not* the reference's wall of pastel tiles — this screen is scanned in five seconds, and
      design.md's "clarity beats decoration" applies hardest here. Queue tiles are buttons that
      jump to where the work is. Refetches on any SSE order event rather than patching, since
      recomputing an aggregate in the browser means re-implementing the SQL and getting it
      subtly wrong
- [x] **Not built, because there's no data behind it**: stock levels ("Low stock"), clock-in
      ("Staff on duty"), waitlist, and table turnover. Drawing those would be faking capability
**Dashboard follow-up — make it analytical, not a status board** — done
*Owner's note: "it looked kind of static… make it a real dashboard you can ANALYZE".*
- [x] **Sales by hour** bar chart, on `placed_at` rather than `paid_at`: the question is when
      the café is busy — which is a staffing decision — not when money was banked, which lags
      and would make a busy unpaid hour look empty. Axis trimmed to the trading day so far
- [x] **Compared against the same time yesterday**, not against a whole finished day — that
      would show a fall every morning. Silent when the baseline is zero; "+100% vs nothing" is
      noise
- [x] **Last 7 days**, **how people paid** (from real `payments` rows, succeeded only — a failed
      payment took no money), and **where orders came from**
- [x] **QR vs counter is inferred, not declared**: a customer's order is converted from a cart,
      a POS order never has one, so `orders.cart_id is not null` separates them. This is why
      `orders.source` (deferred in slice 3) has still not been needed
- [x] Splits are percentages of **money, not order count** — two ₹30 chais and one ₹500 biryani
      are not "mostly chai" in any sense an owner cares about
- [x] Charts are hand-drawn with divs, no charting dependency: two bar charts aren't worth the
      bundle on a tablet over café wifi, and this way they inherit the design system. Every bar
      is focusable and carries its own label, so the chart isn't a picture only a sighted mouse
      user can read
- [x] **Found only by looking at it**: the bars rendered at zero height. The row is `items-end`,
      so columns size to content, and a percentage height inside a zero-height box draws
      nothing. jsdom does no layout, so the tests passed with an invisible chart — a reminder
      that "tests green" is not "the feature works"
- [x] Tests: 144 server + 73 web. Mutation-checked seven more ways (the yesterday window, the
      hourly zero-fill, failed payments counted in the mix, the channel split inverted, bar
      labels, the channel section, and the delta) — each verified as actually applied first
- [x] Two of my own test bugs found and fixed: the "yesterday" test computed its boundary in
      PGlite's session zone while asking the API for UTC, and the carts insert omitted NOT NULL
      columns

- [x] Tests: 139 server (new `dashboard.test.js`, which truncates orders per test so the
      arithmetic is asserted on a known state) + 69 web. The web test asserts the screen renders
      what the endpoint returned rather than re-deriving totals, since that suite shares one
      database. Mutation-checked seven ways — unpaid counted as taken, cancelled counted as
      orders, prep measured from the wrong event, the empty-day null, swapped money tiles, a
      dead queue tile, and best sellers not rendering — each verified as actually applied before
      being believed, after one mutation silently failed to apply and produced a false pass

**Slice 5 — Staff management** — done
- [x] **Migration `20260926130000_staff_roles_and_invites.sql` — applied to Supabase.** Adds
      `kitchen` to the `staff_role` enum and a `staff_invites` table. Existing rows need no
      backfill: `staff` keeps what it had plus POS, which is the intended widening
- [x] **Three roles.** `owner` everything · `staff` = front of house (board, 86'ing, and the
      till: POS, accepting QR orders, checkout) · `kitchen` = board and 86'ing only. This is
      what closes the gap flagged in the previous slice, where a QR order could only be
      accepted by the owner. `requireFrontOfHouse` in `middleware/auth.js`; POS's routes moved
      off owner-only
- [x] **Invites are pre-authorised emails, not accounts, and no email is sent.**
      `staff_members.user_id` is the PK and (on Supabase) an FK to `auth.users`, so a person
      must exist as an auth user before being linked — a pending invite therefore can't live in
      `staff_members`. The owner adds an address + role; the invitee signs up themselves; their
      first authenticated request claims it (`claimInvite`, one statement so two simultaneous
      first-requests can't both link). Chosen over Supabase's `inviteUserByEmail` because that
      depends on SMTP the project hasn't configured — the risk this slice's original plan
      already flagged
- [x] **The trust boundary, written down because it's easy to get wrong:** the email is read
      off the *verified Supabase user*, never from the request — but it's only as strong as
      Supabase's own "Confirm email" setting, which is what proves the person owns the inbox.
      If that's off, Supabase auto-confirms and `email_confirmed_at` is set regardless, so the
      column alone is not a safeguard. Invites expire after 7 days and can be revoked
- [x] `GET /staff`, `POST /staff/invites` (re-inviting replaces the open invite), `DELETE
      /staff/invites/:id`, `PATCH /staff/:userId`, `DELETE /staff/:userId`. Removing unlinks
      only — the Supabase Auth account is left alone, since that identity may be used elsewhere
- [x] **Last-owner guard**: neither demotion nor removal can leave a cafe with no owner, because
      there would then be nobody able to put one back — a door that locks from the outside
- [x] `StaffTab.jsx` replaces the placeholder, in POS's visual language: the team with an inline
      role picker, inline remove confirmation (not `window.confirm`, same as the board's
      Cancel), an invite form whose role options carry their own descriptions, and a "waiting to
      sign up" list with expiry and revoke
- [x] Tests: 130 server (was 121) + 62 web (was 57), including a new `staff-admin.test.js`.
      Mutation-checked seven ways — invite expiry, the till gate, the last-owner guard,
      case-insensitive email matching, the role picker persisting, "Keep" not removing, and the
      kitchen not getting POS — all caught
- [x] Found while wiring the fixtures: the new kitchen test user reused the UUID of the
      deliberately-unlinked fixture, which silently made the "not linked" test pass for the
      wrong reason. Given its own id
- [x] **Gap found the moment it was used for real: there was no way to sign up.** The invite
      deliberately creates no login, but `/staff` only had `signInWithPassword` — so an invited
      person hit "Invalid login credentials" and had no route in. `SignInScreen.jsx` now has a
      sign-up mode ("Been invited? Create your account"), `useStaffSession` gained `signUp`, and
      the screen reports the confirmation-pending case explicitly instead of looking stuck.
      Anyone may create an account; that grants nothing on its own — access still comes only
      from claiming an invite. Tests cover the whole journey: invite → sign up → linked with the
      invited role, an uninvited sign-up being refused, the confirmation notice, and a sign-up
      error clearing when you switch back. Mutation-checked three ways, all caught
- [ ] **No invite email is sent, by design** (see ARCHITECTURE §6) — but note what the invitee
      *does* get: with "Confirm email" on, Supabase emails them a confirmation link when they
      sign up. If a genuine "you've been invited" email is wanted later, that needs custom SMTP
      configured in Supabase first; the pieces compose, nothing here has to change
- [ ] **Worth doing before real staff use it:** confirm "Confirm email" is enabled in Supabase
      Auth settings (Authentication → Providers → Email). Everything above assumes it
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

**Slice 7 — Menu tab: categories, photos, and the Tailwind migration** — done

**Decided:** categories become a **record** (`menu_categories`, migration 5), not the free-text
`menu_items.category` column they were. The free-text column couldn't represent two things the
owner actually needs — a category that exists before anything is in it, and a menu order that
isn't the alphabet's — and both are properties of the category, not of an item. `category_id`
is **nullable**, and null reads as "Uncategorised" everywhere: that keeps step 5's `POST /items`
contract ("name and price, everything else optional") and means deleting a category has somewhere
to put its items without a magic fallback row. Photos land in a public `menu-images` Supabase
Storage bucket, uploaded **through the API** (raw bytes + an image Content-Type, no multipart
parser and no new dependency) so the service-role key stays the only writer and the stored URL is
one the server produced. Built from an owner-supplied POS reference; **not** taken from it, for
the usual "don't fake capability" reason: AI-generated descriptions, Variants/Add-ons/Combo,
Key Ingredients, the "5/20 items used" quota, and Clock In — none of which have any schema.
Teal, not the reference's blue, per `design.md`'s one rule.

- [x] Migration `20260927120000_menu_categories.sql`: `menu_categories` (name + `display_order`,
      unique per café case- and whitespace-insensitively), `menu_items.category_id` with the
      usual composite FK, backfilled from the distinct values already in use — ordered
      alphabetically so nothing visibly reordered the moment it landed — then the text column
      dropped and both partial indexes rebuilt on `category_id`
- [x] Backfill verified against pre-migration data specifically (the test path never exercises
      it, since the seed now inserts categories directly): sloppy spellings merge, existing
      "Uncategorised" items stay null, a category that exists only because of a soft-deleted
      item isn't created, and one café cannot be filed under another's section
- [x] `GET/POST/PATCH/DELETE /categories` — owner-only except the read. A new category lands at
      the **end** of the menu when no `display_order` is given; a duplicate name is a 409 from
      the unique index, not an app-level check; deleting one moves its items to Uncategorised in
      the same transaction and returns `moved_items`
- [x] `PUT /items/:id/image` and `DELETE /items/:id/image` — owner only, PNG/JPG/WEBP, 5MB.
      Replacing writes a new path (a cached copy of the old one can't win) and deletes the file
      it replaced; deleting the item deletes its file too. The bucket is created on demand
      rather than being a setup step the owner has to remember
- [x] Customer menu renders the photo as a fixed square thumbnail and reads in the owner's
      category order — a photo nobody eating ever sees would be pointless
- [x] `MenuTab.jsx` rebuilt in Tailwind: header card, Menu items / Categories sub-tabs, search
      over name and description, photo cards with a monogram fallback, hover edit/delete, and
      the 86 toggle still available to the kitchen. `ItemForm.jsx` rebuilt with the upload box
      and a category picker; `CategoryForm.jsx` is new. Menu came out of `Board.jsx`'s
      `.staff-legacy` list
- [x] Tests: 16 new server tests (`menu-categories.test.js`) and 10 new web tests. Server 144 →
      160, web 73 → 81. Mutation-checked, 11 mutations, all caught — one of which exposed a real
      redundancy (two statements in the category delete, where the second silently did the
      first's work), now one statement
- [x] Two test-harness gaps found and closed: an assertion sitting outside a `try/finally` left
      an item 86'd for every later test in the run, and jsdom has no object-URL store, so
      `URL.createObjectURL` is stubbed in `test/setup.js` alongside the dialog and Web Audio
      fakes

**Slice 8 — Settings: café profile, seating plan, user account** — done

**Decided:** three views behind one Settings tab, replacing the top-level Tables tab — the
seating plan was already that screen, and two places to manage the same tables is how they
drift apart. Restaurant Profile and Seating Plan are the café's, so owner-only; **User Account
is every role's**, because a name and a password shouldn't need the owner. A non-owner gets no
tab strip at all rather than tabs it can't use. Built from an owner-supplied reference; **not**
taken from it: its **Tax Rate** field (see below), its UPI ID, and the Payment / Kitchen Mode /
Billing tabs, none of which have anything behind them.

**Tax stays out (ARCHITECTURE §2).** The reference puts a tax rate on this screen, but
`orders.tax_amount` is always 0 and applying a rate touches order creation, both bills,
checkout and the dashboard's takings — it is a change to how every order is priced, not a
settings field. Storing one without applying it would let the screen promise a tax nothing
charges, so there is deliberately no column and no field. Its own slice when it happens.

- [x] Migration `20260927160000_restaurant_profile.sql`: `restaurants.address` and
      `restaurants.phone`, both nullable — a café that hasn't filled them in is a normal state,
      not an incomplete record
- [x] `GET /restaurant` (any staff member — the currency alone decides how every price on their
      screen is formatted) and `PATCH /restaurant` (owner). Partial: `address`/`phone` are
      clearable with an explicit null, `name`/`currency_code` are not. The currency is
      uppercased and shape-checked in `validate.js`, since the column's own check only enforces
      length
- [x] `PATCH /tables/:id` — rename, reseat, **pause**. Closes two items that had been on the
      after-v1 list since step 5. Pausing is what `is_active` was always for: `openMenu` already
      403s an inactive table, so a paused table's printed code stops taking orders immediately
      and works again when resumed. `qr_token` is deliberately untouchable — it is printed on
      something physical
- [x] `PATCH /me` — your own display name, and nothing else. A role is not a field there, so no
      login can promote itself
- [x] `SettingsTab.jsx` + `RestaurantProfile.jsx` / `SeatingPlan.jsx` / `UserAccount.jsx`, all
      Tailwind. `TablesTab.jsx` deleted, its content rebuilt as the seating plan; Settings joins
      every role's sidebar. **Recent is now the only tab left on the legacy dark theme**
- [x] A password change never reaches this API — the browser's own Supabase client holds the
      session and changes it directly, so no password is sent to or logged by a server we wrote.
      Renaming yourself updates the sidebar, not just the form
- [x] The seating plan warns before printing when the page's own origin is localhost: the QR
      codes encode wherever you are browsing from, so a sheet printed from a dev address is
      twenty dead links
- [x] Tests: 13 new server (`settings.test.js`) and 11 new web. Server 160 → 173, web 85 → 92.
      Mutation-checked, 16 mutations, all caught

**Slice 9 — Seating plan: a real floor plan, and retiring a table** — done

**Decided:** positions are **grid cells, not pixels** — a pixel offset means something
different on a phone, a till and a printed sheet. The owner's arrangement is not decorative:
POS's floor map draws from the same positions, so the till shows the room as it is. POS keeps
its own cards (they carry a running total and a sitting time, which a twelfth of a panel
cannot), but places them on the arrangement, **compacted** so a plan using columns 0/3/7 is
three columns of readable cards rather than twelve tiny ones.

**Delete had to be soft.** `orders.table_id` references `restaurant_tables` **ON DELETE
CASCADE**, so the trash icon in the reference would have silently erased every order ever
placed at that table — items, payments, timeline — from the dashboard's history. It sets
`deleted_at` instead, and is **refused with 409 while the table owes money**, because retiring
a table mid-service hides a bill nobody would see again.

**Three statuses, not five.** The reference legend has Available / Occupied / Waiting / Dirty
/ Reserved. Free and occupied are real (derived from live orders, the same definition
`GET /floor` already used) and paused is a real column; **Waiting, Dirty and Reserved have no
schema at all**, so they are not drawn. Same rule as the menu's AI descriptions and variants.

- [x] Migration `20260927190000_table_layout.sql`: `pos_x`/`pos_y` (nullable grid cells),
      `deleted_at`, a partial unique index so **two tables can never share a cell**, and the
      label constraint rebuilt as a partial index so a retired "Table 4" stops holding the name
      hostage. Existing tables backfilled six to a row in the order they were already listed in,
      so the first open is arranging rather than untangling
- [x] Backfill verified against pre-migration data specifically (the seed runs after every
      migration, so the test path never exercises it): placement, stacking refused, a retired
      table freeing both its name and its cell, and two live tables still unable to share a name
- [x] `DELETE /tables/:tableId` — soft, owner only, 409 while unpaid. Clearing `is_active` with
      it is load-bearing: `guestSession.js`, the dashboard's occupancy count and
      `staffOrders.js`'s "can I put an order here" all gate on that column, so one write retires
      the table everywhere those look. `GET /menu/:token` now 404s a retired table's code
- [x] `PATCH /tables/:id` takes `pos_x`/`pos_y` (both or neither — half a position is not a
      place). `POST /tables` places a new table in the **first genuinely free cell**, not
      "however many tables there are", which would land on top of one as soon as anything had
      been moved or retired
- [x] `FloorPlanCanvas.jsx`: a 12x8 dotted grid, tables dragged with a pointer **or moved a cell
      at a time with the arrow keys** — a plan you can only arrange with a mouse is one half the
      people here can't use. Both paths go through one `moveTo`, so they can't drift apart
- [x] `SeatingPlan.jsx` rebuilt: inline add row, the plan, a legend, and a table list with
      capacity steppers, pause/resume, rename, QR and remove. `TableQrDialog.jsx` shows one code
      large with SVG and PNG downloads (SVG is what `qr.js` already produced, so it prints sharp)
- [x] Tests: 9 new server, 9 new web. Server 173 → 182, web 92 → 101. Mutation-checked, 16
      mutations; one exposed a weak test of mine (the seeded layout happens to match creation
      order, so a "reads in layout order" assertion on it proved nothing) and one showed the
      client-side stacking guard is only distinguishable from the database's by whether the
      person gets an error banner

**Slice 10 — Making the floor plan feel like a floor plan** — done

Owner feedback after slice 9: the plan "is not that interactive". It wasn't — the card sat
still through the whole drag and jumped on release, and a refused drop did nothing at all with
no hint why, which reads as a bug rather than an answer.

- [x] The dragged card **follows the cursor**, lifted (scale, raised z, heavier shadow), as a
      CSS transform so `left`/`top` stay the table's real cell and nothing downstream has to
      know a drag is happening
- [x] A **drop-target outline** tracks the pointer: teal when the square is free, red when it
      is taken, with a live line saying "Drop in row 3, column 5" or "That square is taken"
- [x] **Escape cancels** a drag in flight (listener on window — a mouse drag may have taken
      focus off the card), and releasing after a cancel lands nothing
- [x] **Selection links the plan and the list**: picking a table on the plan highlights its row,
      and the row's name finds it on the plan
- [x] The drop-target outline follows the **card**, not the cursor — grab a card by its corner
      and those are half a cell apart, and the square that lights up has to be the one the card
      is over
- [x] The drag path is now **actually tested**, which it wasn't in slice 9: jsdom does no
      layout, so the plan measures 0x0 and a pointer drag has nothing to land on — the tests
      give it a real `getBoundingClientRect` (12x8 cells of 100px) and drive genuine pointer
      events through it. 4 new web tests, 101 → 105. Mutation-checked, 7 mutations, one of
      which showed the release was re-measuring a cell the preview had already decided — it
      now lands on exactly the square the outline drew
- [x] Two bugs found by driving the real component in a real browser, neither of which any
      test or screenshot would have caught: `scale-110` compiles to Tailwind v4's standalone
      `scale` property, which composes after `transform` and so multiplied the drag translation
      by 1.1 (the card drifted a cell from its own target); and the drag hint sat across the top
      row, covering the tables

**Slice 11 — Recent on the design system, and a day at a time** — done
*The last tab on the legacy dark theme. Built from an owner-supplied reference
(an Orders screen with Today/Yesterday tabs, Completed/Cancelled pills, a
search field and a staff/payment table); taken as structure, not
feature-for-feature.*

**Decided:** Recent reads a whole **café day** rather than a rolling window.
`?hours=` stays (it is a different, still-useful question — "what just
happened"), but the tab asks `?day=today|yesterday&tz=`, with the boundary
computed in the browser's own zone exactly as `GET /dashboard/summary` does:
Postgres runs in UTC, where the day rolls at 05:30 IST, mid-morning-shift.
Asking both ways in one request is a **400**, not one silently winning.

- [x] `GET /orders/recent` gained `?day` + `?tz`, and each row now carries
      **who finished it** (the actor on the finishing status event, joined to
      `staff_members`) and **how it was paid** (the *succeeded* `payments` row's
      method). Both come from records that already existed — a wider select, no
      new schema. Either can be null and that is a real answer: a cancelled
      order was never paid for, so the column reads "—" rather than "Unpaid"
- [x] The day is stepped back in **local** time and only then converted to an
      instant, so a 23- or 25-hour day where the café is still reads as one day
- [x] `RecentOrders.jsx` rebuilt in Tailwind: header card, Today/Yesterday tabs,
      All/Served/Cancelled filter pills, a search over order number, table,
      staff and dish, and a seven-column row (order + status, table, items,
      time, staff, payment, amount). Rows are real `<button>`s laid out on a
      grid rather than a `<table>`, so the whole row is one tab stop and its own
      text reads out in column order
- [x] **All** is the default filter, not Served: a cancelled order sitting
      between two served ones is exactly what "why doesn't the till match" is
      looking for, so splitting them by default would hide the thing being
      looked for
- [x] **Not taken from the reference**: its Clock In button (no schema — same
      rule as the menu's AI descriptions), its blue, and its bare
      Completed/Cancelled split
- [x] `.staff-legacy` is gone from `Board.jsx` — **every tab is now on the
      Tailwind system**, which closes the migration that had been open since
      step 6 slice 3. `staff.css` is now reachable only by the sign-in screen
      (`.staff-centered` / `.staff-signin`); the rest of that file is dead and
      is worth pruning in its own pass
- [x] Column widths are sized to fit a 1024px laptop once the sidebar has taken
      its 256px — the first draft pushed the **amount** off the right edge
      there, which is the one column nobody thinks to scroll for. Found by
      looking at it, not by a test
- [x] Tests: 186 server (was 182) + 108 web (was 105). Mutation-checked 11 ways
      — the café-zone boundary, the finishing-event actor, a payment that never
      succeeded, the day/hours refusal, the day tab reaching the server, the
      status filter, the search, the unpaid flag, the staff cell, and the
      Refresh button — all caught. Two needed a second pass: one mutation
      landed on the error banner's Retry instead of Refresh, and one of my own
      assertions was **vacuous** — it checked a row was absent while the screen
      was still blanked to "Loading…", so it passed even with the day tab
      wired to nothing. It now waits for the day to have actually loaded first
- [x] **The sidebar names the café, not the owner.** Owner feedback on the finished
      tab: that corner should say which café you are in, which is what every number on
      every screen is scoped to — and on a shared till it is the question with a wrong
      answer worth catching. `req.staff` now carries `restaurantName` (the auth query
      already joined `restaurants` for its `is_active` check, so the name is free and no
      screen fetches it separately), the invite-claiming path returns it too, and renaming
      the café in Settings updates the sidebar without a reload, exactly as renaming
      yourself already did. Who is signed in stays in Settings → User account, which is the
      only place it can be changed. **Worth knowing:** nothing on the dashboard now names
      the signed-in person outside that screen — fine for a single-owner café, worth
      revisiting if a shared till ever needs "who is on this terminal" at a glance
- [ ] **Known flake, worth chasing on its own.** The Settings test "owner can add a
      table inline" fails roughly 1 run in 5, and **reproduces on a clean tree** — it
      is not from this slice. Separately, a trio of QR-approval tests (two in POS, one
      on the Dashboard) failed together twice during this slice's work and then did not
      reappear in ~20 runs; I could not reproduce them on demand and so cannot attribute
      them either way. Both have the same shape and probably the same root cause: a test
      asserting an **exact count** against the one database every web test shares, so
      anything another test leaves behind breaks it. The fix is per-test isolation (own
      table, own café, or a truncate) rather than chasing each symptom — note that six
      clean runs prove little at these rates, so measure before and after

## Step 7 — Landing page and self-serve signup

**Slice 1 — Create your café** — done

**Decided:** the café is created **after** the email round trip, not before it. With
Supabase's "Confirm email" on — which the whole invite model's trust boundary depends
on — `signUp` returns no session until they click the link, so anything typed before
that would have to be parked somewhere. Holding it in a `pending_restaurants` table
(mirroring `staff_invites`) was considered and dropped: it is a migration and a second
claim path, to store a form for someone who may never come back. Instead the sign-up
screen takes email and password only, and the **dead end becomes the offer** — the
"this login isn't linked to a café, ask the owner to add you in Supabase" screen is now
`CreateCafeScreen`, which is no help at all to the person who *is* the owner.

- [x] Nothing had to be retrofitted for multi-tenancy: every query already scopes by the
      `restaurant_id` on the caller's `staff_members` row, and no restaurant id is
      hardcoded anywhere in `server/src` or `web/src` (the demo's UUID appears only in a
      test fixture). A second café is two more rows, and the test asserts exactly that —
      the new café cannot see the demo's tables or menu, or be seen by it
- [x] `POST /restaurants` — the only route a signed-in person **without** a café may call,
      and the only write not scoped to a café the caller already belongs to. New
      `requireAuthUser` middleware: a verified Supabase user, no staff row required. The
      id and email come off the verified token, never off the request, same rule the
      invite claim follows
- [x] The restaurant, its owner and its tables are created in **one transaction**. A
      restaurant with no owner is a café nobody can open; an owner row pointing at nothing
      is a login that 403s forever. The "are you already linked" check is inside that
      transaction (`for update`), so two taps on a slow connection can't both pass — the
      second gets a 409 naming the café they already belong to
- [x] **The form asks how many tables**, and they are placed six to a row, matching the
      layout migration's own backfill — so the first open of the seating plan is a room to
      arrange rather than an empty grid and a button. Capped at 48: the plan is 12x8 and
      that is where the room stops fitting on it. Zero is allowed and is a real answer
- [x] **The menu starts empty.** Tables are generic; dishes are not, and seeded example
      dishes would be fake data in a real café's records
- [x] Found by mutation-checking: the route hand-built `role: 'owner'` in its response
      while the service wrote the row, so the API could have claimed a role the database
      didn't hold — breaking the insert to `kitchen` changed nothing any test could see.
      The insert now returns the row it wrote and the response is built from that, and the
      test proves the role by reaching an **owner-only route**, not by reading the reply
- [x] Tests: 194 server (was 186) + 110 web (was 108). Mutation-checked 4 ways, all
      caught after the fix above
- [x] **Fixed a latent flake while here.** Three tests (two POS QR-approval, one Dashboard
      tile) counted the whole approval queue rather than looking for their own order in
      it, and failed together, intermittently, against the shared test database — the
      first to fail leaves its own unapproved order behind for the next two. They now
      clear the queue first. The original source was never pinned down; the obvious
      suspect, the customer suite placing orders it never approves, is ruled out because
      Vitest runs the staff file first

**Slice 2 — the landing page** — done, then **redesigned** after the owner saw it

*First version was warm-palette plain CSS with a drawn diagram and no product
imagery. The owner's verdict: bad taste, wrong colours, buttons that didn't feel
like they worked, nothing to look at, doesn't feel interactive. Rebuilt to a
supplied B2B brief — Linear/Stripe-flavoured, neutral base, one accent.*

- [x] **Rebuilt in Tailwind on the dashboard's language**, not the customer app's: white
      and charcoal with teal reserved for the things you can act on. The page's reader is
      an owner deciding whether to trust this with their service, and the calm version is
      the persuasive one. Tailwind rides in the landing chunk only, the same scoping
      `staff/tailwind.css` uses
- [x] Nine sections per the brief: sticky nav, hero with the product beside it, an honest
      strip, problem cards, four alternating feature blocks, how-it-works, pricing, a
      dark closing CTA, footer
- [x] **The product is the hero visual.** `ProductMockups.jsx` draws the kitchen board,
      the POS floor, the menu grid and the customer's phone in the real dashboard's own
      design — same status palette, same card shapes. Mockups rather than screenshots
      because a screenshot of the live café would carry a real café's orders; the frames
      are sized so real screenshots can replace them one for one
- [x] **Interaction it was missing:** hover and press states on every control, a nav that
      only grows its border once you leave the top, smooth anchor scrolling, and sections
      that fade up as you reach them
- [x] **"The buttons don't work" was real, but not in the wiring** — every link resolved.
      What was missing was feedback: nothing moved, nothing responded. A test now walks
      every anchor on the page and fails if one points at a section that does not exist,
      and asserts both CTAs and Sign in reach `/staff`
- [x] **The honesty rule stays a test.** No "trusted by N", no years, no uptime figure, no
      free trial with a clock nobody runs. The social-proof strip the brief allows says
      what is true — built in Tripura, running live in its first café — rather than a
      wall of invented logos. Pricing says ₹0 while in beta, which is the actual price
- [x] **Root-caused the cascade trap instead of working around it.** `styles.css` styled
      the customer app's furniture with bare `main`, `section` and `section h2` selectors —
      `section h2` being the menu's small grey uppercase category heading — so every
      heading on the first landing page came out shouting. They are now scoped to `.app`,
      the customer screens' own wrapper. `.message`/`.confirmation` set their own padding,
      so nothing outside `.app` ever depended on them; verified by diffing the customer
      menu before and after
- [x] **A reveal animation must never be able to hide the page.** The first version used
      an IntersectionObserver, which only reports a *change* in intersection — sweeping
      the page in steps left several sections sitting at `opacity: 0` with real content
      inside them. It now re-checks position on scroll, so it cannot get stuck, and skips
      itself entirely under `prefers-reduced-motion`. Verified by walking the whole page
      in half-viewport steps and asserting no section is ever blank while on screen
- [x] **Worth knowing for the next visual check:** the browser pane reported
      `document.hidden === true` for this whole session, so its screenshots lagged and
      `requestAnimationFrame` was throttled. Two of the "bugs" above were only visible by
      measuring elements from JavaScript. If a screenshot looks wrong, measure before
      believing it — and do not build behaviour on rAF
- [x] **Second owner note: the page sold only the QR half.** It read as if Petuk were a QR
      menu, when the same system also rings up walk-ins at the till, holds the floor plan
      and adds up the day — each of those a reason an owner would choose it. The feature
      showcase went from four blocks to seven, with three new mockups drawn from the real
      screens: **POS order entry** (pick a table, tap through the menu, send it — no QR
      code involved), the **seating plan** on its dotted grid, and the **dashboard** with
      takings kept separate from money still owed and sales by hour. Plus a six-card grid
      for the things that don't need a screenshot each: staff roles and invites, table
      bills, printable QR sheets, order history, the live stream, the seven-day view
- [x] The features heading is no longer "Four screens" but "One tool for the table, the
      till and the kitchen", with a line under it saying QR ordering is where it starts
      and not where it stops
- [x] Tests: 194 server (unchanged) + 115 web (was 110). Mutation-checked 8 ways, all
      caught: a dead nav anchor, CTAs pointing nowhere, a free-trial line, a trusted-by
      count, and — after two misses on the first pass — the POS block losing its label and
      each of the three new mockups being swapped for another. The first version of that
      test asserted the *words* on the page but not that the right screens were **shown**,
      which is the whole point of the section

*Original slice 2 notes, superseded by the rebuild above:*

- [x] `/` is the landing page, lazy-loaded exactly like `/staff`: a customer scanning a
      table never downloads it. Verified in a production build — the landing chunk is
      6.8 kB JS + 4.8 kB CSS and the customer bundle contains none of it
- [x] Warm customer palette, built on the tokens already in `styles.css`, so the page and
      the app a visitor is about to scan into cannot drift into two different browns. It
      inherits dark mode for free, which is most of the argument for reusing them
- [x] Five sections: hero, the flow **drawn** (`FlowDiagram.jsx`, inline SVG), why Petuk,
      what it deliberately doesn't do, and Create your café. The approval step is the one
      thing a café owner does not expect, so it is a box in the picture with the counter's
      colour and a line under it — "nothing reaches the kitchen until someone says yes"
- [x] **The honesty rule is a test, not a convention.** `App.test.jsx` asserts the page
      carries no "trusted by N", no years-in-business, no uptime figure, no pricing and no
      free-trial badge — there is one café and it is the owner's own. Mutation-checked
      both ways: adding a free-trial line, or a "Trusted by 200+ cafés" reason, fails the
      suite. Whoever edits the copy next gets told
- [x] **A second instance of the cascade trap, in a new place.** `styles.css` styles the
      customer app's own furniture with *unlayered element* rules — `main`, `section`, and
      `section h2`, which is the menu's small grey uppercase category heading. This page is
      customer-side and uses those same elements, so every section heading came out
      shouting. A cascade layer can't help here (the page is inside that stylesheet's own
      world); only out-specifying every property it sets does. Written up in `design.md`
      beside the original
- [x] Two layout bugs found by **measuring the real page in a browser**, neither visible in
      a screenshot: `overflow-x: auto` on a section computes `overflow-y` to `auto` as
      well, which turned the whole section into a scroll box and cut the diagram off; and
      centring each section child as its own block meant any child with its own `margin`
      shorthand silently un-centred itself, while a narrower child centred instead of
      lining up under its heading. Both fixed by one measured column per section
- [x] Tests: 194 server (unchanged) + 113 web (was 110). Mutation-checked 6 ways, all
      caught
- [ ] **Needs the owner: real screenshots.** `SCREENSHOTS` in `LandingPage.jsx` is an empty
      array and that section renders nothing while it is — an empty frame captioned "your
      dashboard here" is a promise, and a drawing of a screen is a picture of software
      rather than the software. Three shots would do it: the kitchen board mid-service, the
      POS floor with a table carrying a bill, and the dashboard. They need a signed-in
      session, so they are yours to take; drop the files in and fill the array

## Step 8 — Customer app redesign

**Slice 1 — the menu, the cart, the bill: white and red, on Tailwind** — done
*Owner brief: a warm, mobile-first menu — coloured header, search with a filter icon, category
tabs, dish rows with a "+" — from a supplied reference and a written prompt.*

**Decided, with the owner:** Tailwind on the **whole** customer app rather than the menu alone
(so the cart, sheet, confirmation and bill cannot look like a different product) · the
prompt's "illustrated tile per dish" and "real dish photo" contradict each other, so **photo,
with a fork-and-knife placeholder** · the filter icon does **Veg / Non-veg / Any**, the one
filter the data can honestly back. Not taken: per-dish illustrations (a guess that would be
wrong for a café's own categories), and anything with no schema behind it.

- [x] `CustomerApp.jsx` is its own lazy chunk importing `customer/tailwind.css`, so Tailwind's
      global preflight loads only on `/t/<token>`. Verified in a production build: the eager
      stylesheet is ~2 kB with no Tailwind in it; the dashboard and landing chunks are untouched
- [x] Menu: header, sticky search + tabs, veg filter popover, dish rows with a photo or
      placeholder, a "+" per row, and a red bottom bar. Item sheet, stepper, cart, confirmation,
      bill and banners all rebuilt in the same language; dark mode was kept at first and then switched off on the owner's request
- [x] Category tabs now **filter** rather than scroll-to, and compose with search and the veg
      filter; a clear action lifts all three
- [x] Shared strings in `components/ui.js`; `BottomBar`, `PageHeader`, `StateScreen` and
      `categoryIcon` are new
- [x] `styles.css` cut to what the other routes still reach (Loading fallbacks, staff sign-in's
      base type, `.veg-mark`), palette moved to the same colours; Fraunces/Inter dropped from
      `index.html` (nothing outside the customer app used them), `theme-color` is red
- [x] Tests: 28 web (was 24). New: placeholder instead of an `<img>`, search by name and by
      description, veg and non-veg, tabs alone and combined with search. Mutation-checked 6 ways
      — veg/non-veg swapped, description dropped from search, tab ignored, empty sections kept,
      clear not lifting the tab (the first version of that test did not catch it; strengthened),
      each verified as applied first
- [x] Looked at in a real browser at 375px in **light and dark**: menu, item sheet, cart. Found
      by looking: rows overflowed the phone because a grid child (`li`) doesn't shrink below its
      content unless told `min-w-0`, so a long description pushed the "+" off-screen — the
      tests were green throughout
- [ ] **Not yet seen with real data:** the photo state (nobody has uploaded one), and the
      confirmation and bill screens (they need a placed order; I do not place orders on the
      live café). Worth one real order and one photo upload on the owner's side
- [x] **Second and third owner passes:** "too bright" → deeper gold, lavender page, softer coral;
      then "exactly the same" → white page, Zomato/Swiggy-like: shadowed cards, gradient header,
      pill search, cream placeholder. the customer app was light-only for a while (see design.md)
- [x] **Fourth owner pass: gold dropped.** "Gold doesn't suit on white, red does" — red is the
      only accent now, header included. **Slip worth recording:** the edit script opened
      `index.html` and `styles.css` for writing *before* reading them, truncating both to empty
      and blanking the app; caught on the next screenshot and rebuilt. Read first, then write
- [x] **Dark mode back on**, at the owner's request: follows the phone, `dark:` classes revisited for
      the white-and-red palette. Checked at 375px: menu, item sheet, filter panel. Not seen in dark:
      cart, confirmation, bill (they need a placed order). The pre-existing Settings flake failed
      once in four full runs — the same test as the handover lists, not touched by this change
- [ ] Item photos are `h-24 w-24` `object-cover`; a very wide photo will crop. Fine for dishes,
      worth a look with the first real uploads

## Incident — an order that fell out of every screen (found by the owner, 2026-09-30)

*Table T4 showed occupied with a ₹0.00 bill after its checkout; POS's Ongoing tab listed
#1063 as Preparing; the kitchen board had no #1063.*

**Root cause, two faults that only hurt together.** (1) The live board patched in **every**
pushed order, including `qr_order_pending` — the event for an order the counter has not accepted —
so an unaccepted QR order appeared in **New** on an open board. (2) `PATCH /orders/:id/status`
never checked approval, so it could be started from there. Started, it was `preparing` with
`approved_at` null, which every screen filters on differently: the board wants approved, the
approval queue wants `placed`, the bill and checkout want approved. So it appeared on none,
could not be paid, and still held its table occupied.

- [x] Server: a move on an unapproved order is a 409 `awaiting_approval`, except a cancel (which is
      what Reject is). The backstop — it holds whatever any client does
- [x] Board: ignores `qr_order_pending` (the cause of the order showing up at all)
- [x] Tests: server 195 (was 194) + web 120 (was 119). Mutation-checked both guards, each verified as
      applied first. **Two existing tests had been passing because of the bug** — they placed an
      order and expected it to appear "live", which it only did through the unapproved push; they
      now approve through the real API, which is what pushes `order_created`
- [ ] **Live data:** #1063 itself is still `preparing` with no approval and needs a decision — approve it
      (it is billable, then checkout clears T4) or cancel it. Not repaired by code on purpose

## Step 9 — Customer-facing order status

**Decided, with the owner:** the customer's phone shows where their order is. Honest about the risk:
a status is only as good as the kitchen's taps, so a stage nobody moves is worse than none — the
wording is written to be true at every stage, and there is **no time estimate**. **Polling, not a
live stream**, after checking what the free tier actually limits: not Supabase "API calls" (these
hit our own server) but the 5-connection pool and the host. Hybrid rules: poll only while a status
screen is showing and something is unfinished, 15s then 30s, paused while hidden, plus Refresh.
"Ready" is worded by a per-café **service mode** (table vs counter).

- [ ] **Migration `20260930120000_service_mode.sql` — NOT YET APPLIED to the live database.** The
      sandbox refused `scripts/db.sh migrate` against production, so it has to be run by the owner.
      **Until it is, `GET /restaurant` (Settings) and `GET /orders/status` return 500 on the live
      database** — the same failure an unapplied migration has caused twice before
- [x] `GET /orders/status`, `restaurants.service_mode`, `PATCH /restaurant` taking it, and the Settings
      control
- [x] Customer: `useOrderStatus` (the polling rules), `OrderStatus` (sentence + step bar), on the
      confirmation and the bill; the confirmation no longer says "the kitchen has your order"
- [x] Tests: server 203 (was 195) + web 135 (was 120). The polling rules are pinned on fake timers —
      15s, slowing to 30s, stopping when finished or empty, pausing while hidden, Refresh restarting,
      a dropped connection keeping the last answer, an expired session ending it, unmount. End to
      end against the real API: every stage's wording, both service modes, a turned-away order, the
      bill. Mutation-checked 6 ways (wording swap, hidden pause, never stops, never slows, the
      "awaiting" stage, session scoping) — all caught
- [x] Looked at in a browser, light and dark, all six stages and both "ready" wordings (a throwaway
      page — the live database can't serve the endpoint until the migration is applied)
- [x] Migration applied by the owner, and a real order placed: the status showed. The Settings
      control was not separately checked
- [x] **Landing page:** one card in the "also" grid — "Customers see where their order is" — plus
      "Pause a table", so the grid is two full rows of four rather than a seventh card stranded.
      Worded to promise only what is true, and the honesty test now rejects "real-time", push
      notifications and any estimate or "exactly when" claim (mutation-checked three ways)

## Step 10 — Landing copy: what it is, and what it costs

- [x] **The hero line no longer says "QR ordering".** It sold only the QR half, which the owner had
      already flagged once. Now: "The table, the till and the kitchen, in one tool for cafés" —
      matching the features heading. (The footer tagline still says QR table ordering, as a label)
- [x] **Pricing: "Free while we're in beta / ₹0" is gone; it is now a 14-day free trial**, at the
      owner's decision, with no subscription model yet. The section says so plainly — no card
      to enter, no price set, "you'll hear what it is from us before it costs you anything" — and
      carries **no amount and no billing period**. That is a test, mutation-checked three ways
      (an invented price, the beta line returning, the "no price set" sentence being dropped)
- [x] The honesty test used to forbid a free trial outright ("a clock nobody is running"); it now
      forbids only the claims that would still be false: no credit card, money-back, cancel anytime,
      lifetime, and any price or period inside `#pricing`
- [ ] **Nothing ends the trial at day 15.** There is no billing and no expiry — `restaurants.created_at`
      is the only record of when a café's 14 days began, and honouring the end is manual. Fine for the
      first café or two; before a stranger signs up unattended, decide what day 15 does (a banner
      in the dashboard, a note to the owner, or an actual lock) and, once a price exists, put it here

## Step 11 — Rename to BurpNBill, then deploy

*Planning only — nothing below is built yet. Written after the owner chose a name and a
domain and settled on a free host. Decisions are marked **(decided)**; recommendations are marked
**(recommended)** and are open until the owner answers.*

### 11a. The rename: Petuk → BurpnBill **(decided; done on `chore/rename-burpnbill`)**

*Casing settled as "BurpnBill", per the brand sheet. Done: every visible string, the customer page title, package names, `burpnbill.session.<token>`, `@layer bnb-customer`, `bnbPage`, the docs, README. Left on purpose: the first comment line of the init migration (an applied migration is not edited for a comment) and the historical entries in this file. Still open in this section: the name-clash search, and the domain.*

The product name changes before the first real café sees it. It is small — about 40 mentions in
~22 files — and cheaper now than after there are printed QR sheets and a public page.

- [x] **Confirm the exact spelling and casing** — "BurpNBill" as one word, as written by the owner —
      and the domain it goes on. Every string below is derived from that one decision
- [ ] **A quick name check before printing anything:** search the name and the domain/app-store/social
      handles for a clash with an existing food or billing product. (Not legal advice; it is a
      five-minute search that is very expensive to skip.)
- [x] User-visible: the landing page (nav wordmark, the monogram — currently "P" — hero, footer, page
      `<title>`), the customer app's `<title>`, the dashboard sidebar brand mark, Create-your-café
      copy, sign-in screen, printed QR sheet header, the checkout receipt
- [x] The landing test asserts some brand text (nav, footer); update it with the copy so the
      "honest claims" tests still run against the real page
- [x] Internal identifiers, renamed for consistency while it is cheap: `petuk.session.<token>` (the
      customer's stored guest session — renaming it means anyone mid-order re-scans once, harmless
      before launch), `@layer petuk-customer` in `styles.css`, `.petuk-print-receipt`, the
      `petukPage` history-state key, and the three `package.json` names
- [x] Docs: `README.md`, `ARCHITECTURE.md`, `design.md`, `schema.md`, this file, and the SQL comment
      that names it. Leave old entries in this file as they are — they are history, and were true
      when written
- [ ] Not renamed on purpose: git history, and the repo folder `qr-cafe-ordering` (the folder name is
      local and nothing depends on it)
- [ ] `theme-color` and the browser-tab icon are already colour-only, so they need nothing

### 11b. Hosting **(decided unless marked)**

- **One free Oracle Cloud "Always Free" VM** for the API *and* the web app **(decided)**. The API is
  a long-running Node process (live streams, an in-memory hub that assumes a single instance), so a
  host that sleeps when idle — Render's free tier, for one — would break the kitchen board and make
  the first request after a quiet spell slow. One VM is exactly the shape the app expects
- **The web app is served from the same VM, same origin** **(decided)**: Caddy serves the built
  `web/dist` and forwards `/api` to Node. One domain means **no CORS to configure and no
  `VITE_API_URL`**; the dashboard, the customer app and the landing page are one deploy
- **Supabase stays the database and Auth** (already in Mumbai, `ap-south-1`)
- **The Oracle account does not exist yet, so the region choice is still open — and it cannot be
  changed after signup.** **(recommended)** pick **Mumbai (`ap-mumbai-1`)** as the home region, or
  Hyderabad. The API makes several queries per request, and every one crosses to Supabase in
  Mumbai; a VM on another continent adds 150 ms or more to each. Prefer the ARM shape (up to 4
  cores / 24 GB) and fall back to the small AMD one — ARM free capacity is sometimes "out of
  capacity" for days, and retrying is normal
- **DNS (recommended):** the domain is at **Namecheap**. Point its nameservers at **Cloudflare's
  free plan** rather than staying on Namecheap's DNS: free TLS in front, the VM's IP hidden, a
  free way to shield the API from abuse. Live streams pass through it fine — the server already
  sends a heartbeat every 25 s, well inside Cloudflare's idle timeout. The simpler alternative is
  to keep Namecheap DNS and let Caddy fetch a Let's Encrypt certificate directly; that also works,
  it just gives up the shield. **Open — owner to choose**
- **A separate production Supabase project (recommended, and I would not skip it).** Today
  development and the only café share one project, so any experiment against the dev database is an
  experiment on real data — a stuck order was repaired by hand on it this very week. The free plan
  allows two active projects. Production gets its own, migrated with `scripts/db.sh migrate`, **never
  seeded** (the seed is the demo café). Development keeps the current one
- **Process supervision:** Node 22 under **systemd** (restart on crash and reboot, logs in
  journald). Docker is optional and not needed for one process

### 11c. What has to change in configuration

- [ ] `APP_BASE_URL` = the production domain — **printed QR codes encode it**, so a wrong value
      means a sheet of dead links (the seating plan already warns when printed from `localhost`)
- [ ] Supabase Auth: **Site URL** and redirect URLs = the production domain (the open item from the
      handover; it decides where a confirmation link lands)
- [ ] Supabase Auth: confirm **"Confirm email" is enabled** — self-serve signup and the invite model
      both trust it
- [ ] `DATABASE_CA_CERT` set so the database connection is *verified*, then turn on **Enforce SSL** in
      Supabase (both already on the housekeeping list)
- [ ] Express **`trust proxy`** — behind Caddy the client IP is otherwise the proxy's, which would
      make per-client rate limiting (below) limit everyone at once
- [ ] Caddy: **no response buffering for `/api/orders/stream`** (`flush_interval -1`), or the kitchen
      board's live updates arrive in lumps
- [ ] The web build needs its `VITE_SUPABASE_*` values at *build* time (they are baked into the
      bundle); the server's `.env` never leaves the VM
- [ ] Open the ports **twice**: Oracle's cloud firewall (the VCN security list: 80 and 443) *and* the
      VM's own firewall — Oracle's Ubuntu images ship with restrictive `iptables` rules, and "the
      port is open in the console but nothing answers" is the classic first-day problem

### 11d. What I will write when we start **(planned)**

- [ ] `deploy/Caddyfile` — static `web/dist`, `/api` reverse proxy, SPA fallback so `/t/<token>` and
      `/staff` reload, streaming for the order stream, security headers
- [ ] `deploy/burpnbill-api.service` — the systemd unit
- [ ] `.env.production.example` — every variable, what it is and where it comes from, no secrets
- [ ] `deploy/deploy.sh` — pull, install, build the web app, restart the service, health-check it
      (and roll back to the previous build if the health check fails)
- [ ] `deploy/backup.sh` + a cron line — see the backups item below
- [ ] A step-by-step **checklist** for the parts only the owner can do: Oracle signup and VM, Cloudflare
      and Namecheap nameservers, Supabase production project, Auth settings, first deploy, first
      real order end to end

**What I cannot do:** anything inside Oracle, Cloudflare, Namecheap or the Supabase dashboard. Those
steps are the owner's, and the checklist will say exactly what to click. **Applying migrations to a
live database is also the owner's to run** — the sandbox has refused it (correctly) once already.

### 11e. Before the first real café, not after **(recommended)**

Ordered by how badly each one hurts if it is missing on a Saturday.

- [ ] **Custom SMTP for Supabase Auth — the one I would have missed.** Supabase's built-in email
      sender is limited to a handful of messages per hour on the free plan. The landing page sends
      people to *sign up*, and sign-up needs a confirmation email, so on a launch day the third
      person to try gets nothing. Use a free transactional sender (Resend, Brevo or similar) on a
      verified sender address on the new domain (SPF/DKIM records at Cloudflare/Namecheap)
- [ ] **Rate limiting on the public routes.** Every QR scan creates a guest session and nothing limits
      how often. The database allows about **5 connections**, so one hammering client can take the
      whole café's board down. A per-IP limit on `/menu`, `/cart`, `/orders`, `/orders/status` and
      the sign-up route (`express-rate-limit`), generous enough that a table of six sharing café
      Wi-Fi — one IP — is never blocked. Needs `trust proxy` first
- [ ] **A daily database backup, stored off the VM.** Supabase's free plan has **no point-in-time
      recovery**, so a bad migration or a mistaken delete is unrecoverable without one. A nightly
      `pg_dump` to object storage (Oracle's free bucket, or Cloudflare R2), kept for a fortnight —
      and **one restore tried for real**, because an untested backup is a hope, not a backup
- [ ] **An uptime monitor** (UptimeRobot or Better Stack, free) on `/health/ready`, which checks the
      database and Supabase Auth. It also does a second job: **Supabase pauses a free project after
      a week of inactivity**, and a check that touches the database every few minutes prevents it
- [ ] **Verify staff tokens locally** (JWT signature) instead of a network call to Supabase Auth on
      every request. Already listed; on a free tier it removes a dependency from every screen and a
      round trip from every tap
- [ ] **Structured request logging** (already listed) — request id, route, status, duration, staff
      id, *no bodies and no tokens* — so "an order vanished" can be answered from the log, not from
      memory. (This week's stuck order was diagnosed from the database; that will not always work)
- [ ] **Decide what day 15 of the free trial does** (see step 10). Manual is fine for one or two
      cafés you know; not for strangers
- [ ] **Watch the Oracle idle rule:** free VMs that sit almost idle for a week can be reclaimed. Real
      traffic prevents it; while there is none, the uptime monitor's pings help but are not a
      guarantee — keep the deploy script so a rebuilt VM is an hour's work, not a day's
- [ ] **A rehearsal:** before any café, deploy, create a *second* café through the landing page on the
      real domain, place an order from a phone on mobile data (not the LAN), watch it reach the
      board, print one QR sheet and scan it. Every "worked on my Wi-Fi" surprise lives in that gap
- [ ] **Know the free-tier ceilings** so nobody is surprised: 500 MB database, 1 GB of photo storage,
      egress limits, a 5-connection pool. Comfortable for a handful of cafés; a number to watch, not
      a wall to hit blind

### Open questions for the owner

1. The exact name spelling/casing and the domain string
2. Cloudflare in front (recommended) or Namecheap DNS + Caddy alone?
3. A separate production Supabase project (recommended) or reuse the current one?
4. Oracle home region at signup — Mumbai (recommended) or Hyderabad
5. Which SMTP sender to use for Auth mail

## Step 12 — BurpnBill brand system (branch `feat/brand-system`, not merged)

*The owner supplied the logo (`bnb.svg`) and the brand sheet, and asked for everything except the
customer app to follow it — on a branch, so `master` keeps the teal design if the result isn't
liked. Rules and rationale: `docs/design.md`, "The BurpnBill brand system".*

- [x] **Tokens, fonts, logo.** `web/src/brand/tokens.css` (Tailwind v4 `@theme`: crimson, butter,
      ink, status pairs, danger, veg, radii, the one shadow), self-hosted Bricolage Grotesque /
      Manrope / JetBrains Mono (`@fontsource-variable/*`, three new dependencies), `Logo.jsx`
      (the supplied mark, four approved colourways), `status.js` + `StatusPill.jsx`. Imported by
      the landing and dashboard chunks only; the customer bundle contains none of it (production
      build checked)
- [x] **Landing page** — crimson hero band with the brand's grid, cream canvas, white cards,
      butter CTAs, ink closing band; mockups redrawn in the brand's status pairs; the phone mockup
      keeps the customer app's own red on purpose. Copy unchanged apart from the name, so the honesty
      tests still hold
- [x] **Sign-in, sign-up, create-your-café, loading/error** on `staff/AuthShell.jsx`;
      **`staff.css` deleted** (closes the "prune the dead CSS" item)
- [x] **Dashboard shell** — dark ink sidebar with the butter wordmark, board, cards, detail drawer
- [x] **POS, checkout, receipt, QR dialog**; **Dashboard, Recent, Menu, Settings, Staff**
- [x] **Visible "Petuk" → "BurpnBill"** on the branded surfaces (landing, dashboard, tab titles,
      account copy). *Not renamed:* the customer app, and the internal names
      (`petuk.session.*`, `@layer petuk-customer`, `petukPage`, `package.json` names) — those stay
      with Step 11a
- [x] **Tests:** web 135 → 155 (`brand/brand.test.jsx`: contrast of every status pair, no default
      palette class under `staff/` or `landing/`, no hex-in-class, no "Petuk", the logo's
      colourways and unique ids, fonts kept out of the customer files). Two existing tests asserted
      a colour class (`bg-teal-50`, `rounded-2xl`) and were updated. Mutation-checked: a stray
      `text-teal-600` and a wrong logo colour are both caught
- [x] Checked in a browser against the real API on an in-memory database (a throwaway harness,
      not committed): landing at 1440 / 375, every dashboard tab at 1440, Recent at 1024, sign-in
      at 375; a dark-mode OS still gets the light brand pages
- [x] **Hero motion** (branch `feat/hero-motion`): the landing hero now follows the owner's
      "BurpnBill motion" template — headline rising line by line ("Order fast. / Settle easy."), a
      drifting grid and two soft blobs, and a looping scene of a phone scanning a QR code, the order
      being approved and moving Placed → Preparing → Ready on a board, and the bill settling to ₹140,
      with a status ticker along the bottom. `landing/HeroMotion.jsx` + `.hm-*` in
      `landing-tailwind.css`, driven by one number (`data-s`). **Only the hero changed**; the nav and
      every section below are as they were. Departures from the template, on purpose: the phone is
      drawn in the customer app's own red (one variable, `--hm-customer`), the copy keeps the "Start
      free" / "See how it works" buttons and the "Free for 14 days" line the tests and honesty rules
      rely on, and the two-column layout starts at 1280px (the 540px scene does not fit beside the
      headline below that; it stacks and centres instead). Reduced motion holds on the finished scene;
      the total counts on timers, not animation frames, so a hidden tab cannot strand it at ₹0.
      The nav is now part of the hero: transparent over the crimson with the butter wordmark and white
      links, turning into the cream bar only once the hero has scrolled past.
      Tests: web 155 → 161 (`HeroMotion.test.jsx`; mutation-checked). The old hero headline ("Your
      staff can't reach every table at 7pm") is gone from the page; the landing test now opens on
      the new one. Checked at 1440 / 1024 / 375
- [ ] **Not checked:** printing (receipt, QR sheet) — unchanged code, but the new fonts are not
      loaded in a print context I can drive; and a real signed-in session (no staff passwords here)
- [ ] **Light only.** The brand sheet defines dark tokens; adopting them for the landing page and
      dashboard is its own piece of work (the tokens make it a variable swap, but every surface
      needs looking at)
- [ ] **No favicon / app icon.** The mark is a wordmark and the sheet forbids altering it. Does the
      owner have a square mark? `index.html` (shared with the customer app) is untouched, so the
      tab icon and `theme-color` are as they were
- [ ] **Customer app** still teal-free red-and-white and still says "Petuk" in its page title —
      decision for the owner whether it joins the brand system
- [ ] Deviations from the sheet, recorded in `design.md`: `cancelled-ink` darkened for AA; the
      sheet's "8.6:1" for white-on-crimson measures 7.7:1; a labelled sidebar instead of a 64px rail
- [ ] Known and unchanged: the sidebar is a fixed `w-64` (no phone layout for the dashboard), and
      POS wants ~1400px of width

## Before first real cafe

*Superseded by Step 11 above — the deploy line and the two items that used to be here now live in
11b and 11e, with the rest of what a real café needs. Kept as a pointer so nothing is lost.*

- [ ] Deploy → 11b/11d · Verify staff tokens locally → 11e · Structured request logging → 11e

## After v1 (out of scope, not forgotten)

- Payments: `POST /payments` against the existing model; `order_payment_updated` SSE event
- Invoices by email/SMS (manual trigger)
- Customer-facing order status
- RLS policies (and `restaurant_id` on `cart_items` / `order_items` to support them)
- Redis pub/sub for SSE across multiple API instances
- Staff "mark as paid" without a payment row, if cafes want paid/unpaid on the board
- Table-level bill on the staff side (all sessions at a table, incl. after a session expires)
- Print / save the bill as PDF; tax invoices (with invoices, above)
- Separate kitchen and reception views
- Structured modifiers, stock counts, tax engine, customer login
