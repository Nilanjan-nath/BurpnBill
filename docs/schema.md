# Schema notes

```
restaurants ──< restaurant_tables ──< guest_sessions ──< carts ──< cart_items
                       │                    │                          │
                       └────────────────────┴──< orders ──< order_items ┘
                                                  │   └──< order_status_events
                                                  └──< payments
restaurants ──< menu_categories ──< menu_items
restaurants ──< menu_items          restaurants ──< staff_members
```

## Three tables the design doc didn't list

| Table | Why it exists |
|---|---|
| `staff_members` | The security model says staff queries must be scoped "by the authenticated user's `restaurant_id`" — that mapping needs somewhere to live. Maps `auth.users.id` → `restaurant_id` + role. |
| `carts`, `cart_items` | `POST /cart/items` and "create an order from the current cart" describe a server-side cart. If you'd rather keep the cart in `localStorage` and post the whole thing to `POST /orders`, these two tables drop out — worth deciding before step 3. |
| `order_status_events` | An append-only log of every status transition, written by trigger. Gives the dashboard an order timeline and makes "who cancelled this?" answerable. |

## Decisions baked into the DDL

**Money is `numeric(10,2)`, never float.** `order_items.line_total` is a stored
generated column, so line math can't disagree with itself.

**Snapshots, not joins, for order history.** `order_items` copies both
`price_at_order` and `name_at_order`. Renaming or repricing a menu item never
rewrites history. Menu items are soft-deleted (`deleted_at`) and referenced with
`on delete restrict`, so history can't be deleted out from under an order.

**Order uniqueness per table is enforced by the database, not by convention.**
Each scan inserts its own `guest_sessions` row; orders hang off the session.
Two people at table 4 get two sessions and two orders that can never merge.

**Cross-tenant references are structurally impossible.** Children carry
`restaurant_id` and point at composite keys — `orders(table_id, restaurant_id) →
restaurant_tables(id, restaurant_id)`, and `orders(guest_session_id, table_id) →
guest_sessions(id, table_id)`. An order for one cafe cannot reference another
cafe's table, even if the application layer has a bug.

**The state machine is enforced twice.** The API returns 400 on an illegal
transition; the `orders_status_transition_guard` trigger raises `23514`
(check_violation) as a backstop. Only `placed→preparing|cancelled`,
`preparing→ready|cancelled`, and `ready→served` are allowed.

**The payment model ships unused in v1.** Nothing writes to `payments` until
payments are built — customers settle at the counter. The table is here so that
turning them on is new code against a stable model rather than a migration against
live order data. Everything below already works and is covered by
`scripts/verify_schema.sql`.

**Payment idempotency is a unique index, not application logic.**
`payments.idempotency_key` is unique, and a partial unique index on
`(order_id) where status = 'succeeded'` means an order can have many attempts but
only one success. A succeeding payment sets `orders.paid_at` by trigger — that's
the denormalised flag the dashboard and the `order_payment_updated` SSE event read.

**The café's own details live on `restaurants`.** `name` and `currency_code` shipped with the
first migration; `address` and `phone` arrived with Settings and are nullable free text — a
café that hasn't filled them in is a normal state, not an incomplete record, and nothing
depends on either being present. The phone is stored exactly as typed: formats vary by country
and normalising them would only lose information.

**There is deliberately no tax-rate column.** `orders.tax_amount` exists and is always 0.
Storing a rate without applying it would let a settings screen promise a tax that no order
charges; applying one touches order creation, both bills, checkout and the dashboard, so it is
its own piece of work (ARCHITECTURE §2).

**The floor plan lives on `restaurant_tables` as `pos_x` / `pos_y` — grid CELLS, not
pixels.** A pixel offset means something different on a phone, a till screen and a printed
sheet; a cell is the same square everywhere. Both are nullable (an unplaced table is a real
state), and a partial unique index on `(restaurant_id, pos_x, pos_y)` means two tables can
never be stacked on one square — dropping a table onto an occupied cell is a 409 the screen
acts on, not a silent overlap nobody notices until they print the plan.

**A table is retired with `deleted_at`, never deleted.** `orders.table_id` references
`restaurant_tables` **ON DELETE CASCADE**, so a real `DELETE` would take every order ever
placed there — items, payments, status events — out of the history the dashboard reports on.
The soft delete also clears `is_active` and the table's cell: `is_active` is what
`guestSession.js`, the dashboard's occupancy count and `staffOrders.js`'s "can I put an order
here" check all gate on, so clearing it retires the table everywhere those look without each
of them having to learn about `deleted_at`.

**The label is unique among LIVE tables only** (`restaurant_tables_label_live_unique`, a
partial index). A retired "Table 4" should not stop the next one being called "Table 4" — the
old row exists for history, not to hold a name hostage. The same applies to its cell.

**`restaurant_tables.is_active` is the pause switch**, not a soft delete. `openMenu` refuses an
inactive table with 403 `ordering_unavailable`, so clearing it stops that table's printed QR
code taking orders and setting it again brings the same code back. Nothing deletes a table:
its code is stuck to a physical table, and `qr_token` is never rewritten for the same reason.

**Menu reads are one indexed scan for the filter.** `menu_items_public_read_idx` is a
partial index on `(restaurant_id, category_id, sort_order, name) where deleted_at is
null and is_available` — the customer menu never touches an 86'd or deleted row. Since
categories became records (step 6) the *sort* is no longer covered by that index: it runs
over a join to `menu_categories`, which holds a handful of rows per cafe, because the
order a menu reads in is the owner's `display_order` and not the category's spelling.

**A null `menu_items.category_id` is Uncategorised**, not missing data. Reads coalesce it
to that name and sort it last. Keeping it nullable is what lets `POST /items` stay
"name and price, everything else optional", and what gives `DELETE /categories/:id`
somewhere to put a section's items without a magic fallback row. Its foreign key is
composite — `(category_id, restaurant_id) → menu_categories (id, restaurant_id)`, like
every other child here — and carries **no `ON DELETE` action** on purpose: the items are
moved deliberately, in the same transaction as the delete. (`SET NULL` on a composite key
would null `restaurant_id` too, and the column-list form that avoids that is Postgres 15+
only.)

**One category name per cafe**, case- and whitespace-insensitively:
`menu_categories_name_key` on `(restaurant_id, lower(btrim(name)))`. A second "beverages"
is a 409 from the database, so there is no read-then-write race to lose.

**RLS is on for every table, with zero policies.** Supabase exposes the public
schema to the `anon` key that ships in frontend JS; without this, anyone with that
key could read and write every order in the database. Service-role connections
(the Express backend) bypass RLS, so this costs us nothing now. Writing real
policies is still the deferred hardening pass — this just closes the door meanwhile.

## Known gaps, deliberately left

- `order_items` / `cart_items` carry no `restaurant_id`, so their link to a menu
  item is checked in application code rather than by a composite FK. Add the
  column when RLS policies land.
- Guest session rows are never deleted — `expires_at` is a logical check the API
  makes on every write. Orders reference sessions, so physical cleanup would break
  history.
- `order_status_events.changed_by` is filled from the `app.actor_id` GUC
  (`select set_config('app.actor_id', $1, true)` in the request transaction). Until
  the backend sets it, transitions are logged with a null actor.
- No tax engine: `tax_amount` exists and defaults to 0.
- `payments` and `orders.paid_at` have no writer in v1. If the dashboard should
  show paid/unpaid for counter settlement, a staff-only "mark as paid" that sets
  `paid_at` directly is enough — it needs no `payments` row and no gateway.
