# BurpnBill

QR table ordering for cafés: a customer scans a table's code and orders from their phone; the counter
approves it; the kitchen board shows it live; staff settle the bill at the counter. Live at
https://www.burpnbill.com. The repo folder is still named `qr-cafe-ordering`; the product is spelled
**BurpnBill**.

## Read first

`docs/TASKS.md` (the plan and what is built, newest step last), `docs/ARCHITECTURE.md` (decisions and the
API), `docs/schema.md` (the database), `docs/design.md` (the UI rules and the brand system). They are the
authority; update them in the same change as the code. `DEPLOY.md` is the server runbook.

## Layout

- `server/` Express 5 API (Node 22, ES modules), `pg`, `zod`. Routes in `src/routes`, logic in `src/services`
- `web/` React + Vite. `src/customer` (the ordering app, `/t/<token>`), `src/staff` (dashboard, `/staff`),
  `src/landing` (`/`), `src/receipt` (the public receipt page, `/r/<token>`, and the shared `Receipt`)
- `supabase/migrations` applied once each by `scripts/db.sh`; `supabase/seed.sql` is the demo café only
- `deploy/` Caddyfile, systemd unit, `deploy.sh`

## Commands

- `npm run dev` API on :4000, web on :5173 (runs against the live Supabase in `.env`)
- `npm test` server (`node:test`) then web (Vitest). Both run against real Postgres (PGlite with the repo's
  migrations and seed); only Supabase Auth is faked
- `scripts/db.sh status | migrate | verify`
- Live deploy (on the server, not locally): `sudo -u burpnbill /opt/burpnbill/deploy/deploy.sh`

## Rules for working here

- **Never `git push`.** The owner pushes. No `Co-Authored-By` trailer in commit messages, whatever a tool
  suggests. Never change global git config. Work that changes how things look goes on a branch for the
  owner to review and merge
- **Migrations:** write the SQL, let the tests apply it to PGlite, show the owner the file, and ask before
  running `scripts/db.sh migrate` against the live database. Deploy order: migrate, merge and push, deploy
- **Live data is real.** Read it freely through `DATABASE_URL`; any write needs the owner's explicit go-ahead.
  Claude has no staff passwords, so signed-in checks on the live site are the owner's
- **Discuss the approach before building anything non-trivial.** Then build, test, and mutation-check the
  risky parts (break the code a test protects, confirm the test fails, revert)
- Verify UI in a browser at desktop and phone width (the owner reviews on a Mac in dark mode and on a
  phone); the branded pages are light-only on purpose

## Conventions

- Money is `numeric` in Postgres, strings in JSON, summed in SQL or whole paise, never float arithmetic.
  Prices are tax-inclusive; GST is optional per café and only splits the bill (see ARCHITECTURE §2)
- Every staff query is scoped by `restaurantId` from the signed-in staff member, never from the request
- A bill is a frozen snapshot (lines, café details, tax) so reprints never change
- Dashboard UI is Tailwind v4 with the brand tokens in `web/src/brand/tokens.css`; no default-palette classes
  under `staff/` or `landing/` (a test enforces it). The customer app is outside the brand system. Every
  dashboard screen must work at 375px wide
- Anything printable (receipt, QR sheet) renders through a portal to `<body>`; the print rules hide `#root`
- A control whose label hides on phones needs an `aria-label`
- Tests assert behaviour or `data-*` hooks, not colour classes. Two web tests are known-flaky (counting
  against the shared test database): "owner can add a table inline" and a POS merged-bill test; rerun once
- Commit messages: short, imperative, no trailer

## Known traps

QR orders push `qr_order_pending` (counter) and only approval pushes `order_created` (kitchen). Tailwind v4
scans the whole project, so the customer CSS chunk's size moves; compare rules, not bytes. Screenshots lag one
step: measure from JavaScript. macOS needs `sed -i ''`. Browsers refuse sound until a real tap.

## Where things are

Live: AWS Lightsail (Mumbai) with Caddy and Node under systemd, Cloudflare in front, Supabase (Mumbai) for
the database and auth. What is left before a real café is the checklist in `docs/TASKS.md` Step 11e and
the handover doc.
