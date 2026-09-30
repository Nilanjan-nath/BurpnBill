// GET /orders/status — where each of THIS guest session's orders is, for the
// phone to show while someone waits. Scoped to the session, never the table, for
// the same reason the bill is: nobody who merely knows the table's QR link can
// see what other guests ordered, or when.
//
// It reports a `stage`, not the raw `status` column. The raw status can't say
// the one thing a customer most needs to hear first — that the counter has not
// accepted the order yet — because that is `approved_at`, a separate column
// (the state machine was deliberately left alone, see ARCHITECTURE §7). Folding
// the two into one word here means the phone never has to know that.
//
//   awaiting   placed, not yet accepted at the counter
//   accepted   accepted, the kitchen hasn't started
//   preparing  the kitchen is on it
//   ready      done — what that means depends on the café's service_mode
//   served     finished; nothing more to say
//   cancelled  turned away or cancelled
//
// No estimate of how long anything will take, on purpose: nothing here records
// it, and a wrong "8 min" is worse than none.
const STAGE_SQL = `
  case
    when o.status = 'cancelled'                            then 'cancelled'
    when o.approved_at is null                             then 'awaiting'
    when o.status = 'placed'                               then 'accepted'
    else o.status::text
  end`;

export async function getOrderStatus(db, guest) {
  const [{ rows: head }, { rows: orders }] = await Promise.all([
    db.query(`select service_mode from public.restaurants where id = $1`, [guest.restaurantId]),
    db.query(
      `select o.id, o.order_number, ${STAGE_SQL} as stage, o.placed_at
         from public.orders o
        where o.guest_session_id = $1
        order by o.placed_at, o.order_number`,
      [guest.sessionId],
    ),
  ]);

  return {
    service_mode: head[0].service_mode,
    generated_at: new Date().toISOString(),
    orders,
  };
}
