# Schema notes

```
restaurants ──< restaurant_tables ──< guest_sessions ──< carts ──< cart_items
                       │                    │                          │
                       └────────────────────┴──< orders ──< order_items ┘
                                                  │   └──< order_status_events
                                                  └──< payments
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

**Menu reads are one indexed scan.** `menu_items_public_read_idx` is a partial
index on `(restaurant_id, category, sort_order, name) where deleted_at is null
and is_available` — the customer menu never touches an 86'd or deleted row.

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
