-- =============================================================================
-- Schema invariant checks. Runs inside a transaction and ROLLS BACK — it leaves
-- no data behind, so it is safe to run against any database with the schema.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify_schema.sql
-- =============================================================================

begin;

do $$
declare
  r_id  uuid;
  r2_id uuid;
  t_id  uuid;
  t2_id uuid;
  m_id  uuid;
  s1_id uuid;
  s2_id uuid;
  o1_id uuid;
  o2_id uuid;
  cart1 uuid;
  n     integer;
  amt   numeric;
  paid  timestamptz;
begin
  -- fixtures ------------------------------------------------------------------
  insert into restaurants (name) values ('Verify Cafe')  returning id into r_id;
  insert into restaurants (name) values ('Other Cafe')   returning id into r2_id;
  insert into restaurant_tables (restaurant_id, label) values (r_id, 'V1')  returning id into t_id;
  insert into restaurant_tables (restaurant_id, label) values (r2_id, 'X1') returning id into t2_id;
  insert into menu_items (restaurant_id, name, price) values (r_id, 'Test Chai', 30.00) returning id into m_id;

  -- 1. qr_token is opaque and unique ------------------------------------------
  assert (select qr_token from restaurant_tables where id = t_id) ~ '^[0-9a-f]{32}$',
    '1: qr_token should be 32 hex chars';
  begin
    insert into restaurant_tables (restaurant_id, label, qr_token)
    values (r_id, 'V2', (select qr_token from restaurant_tables where id = t_id));
    raise exception '1: duplicate qr_token should have been rejected';
  exception when unique_violation then null;
  end;
  raise notice 'PASS 1  qr_token opaque + unique';

  -- 2. two scans at one table produce independent sessions and orders ---------
  insert into guest_sessions (restaurant_id, table_id) values (r_id, t_id) returning id into s1_id;
  insert into guest_sessions (restaurant_id, table_id) values (r_id, t_id) returning id into s2_id;
  assert s1_id <> s2_id, '2: sessions should be distinct';

  insert into orders (restaurant_id, table_id, guest_session_id, subtotal, total_amount)
  values (r_id, t_id, s1_id, 30.00, 30.00) returning id into o1_id;
  insert into orders (restaurant_id, table_id, guest_session_id, subtotal, total_amount)
  values (r_id, t_id, s2_id, 60.00, 60.00) returning id into o2_id;

  select count(*) into n from orders where table_id = t_id;
  assert n = 2, '2: same table should hold two separate orders, got ' || n;
  assert (select order_number from orders where id = o1_id)
      <> (select order_number from orders where id = o2_id), '2: order numbers must differ';
  raise notice 'PASS 2  two guests at one table -> two independent orders';

  -- 3. cross-tenant references are impossible ---------------------------------
  begin
    insert into orders (restaurant_id, table_id, guest_session_id)
    values (r_id, t2_id, s1_id);   -- other restaurant's table
    raise exception '3: cross-tenant order should have been rejected';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into guest_sessions (restaurant_id, table_id) values (r2_id, t_id);
    raise exception '3: cross-tenant session should have been rejected';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PASS 3  cross-tenant table/session references rejected';

  -- 4. one open cart per guest session ----------------------------------------
  insert into carts (restaurant_id, table_id, guest_session_id)
  values (r_id, t_id, s1_id) returning id into cart1;
  begin
    insert into carts (restaurant_id, table_id, guest_session_id) values (r_id, t_id, s1_id);
    raise exception '4: second open cart should have been rejected';
  exception when unique_violation then null;
  end;
  -- closing the first one frees the slot
  update carts set status = 'converted' where id = cart1;
  insert into carts (restaurant_id, table_id, guest_session_id) values (r_id, t_id, s1_id);
  raise notice 'PASS 4  at most one open cart per guest session';

  -- 5. order status state machine ---------------------------------------------
  begin
    update orders set status = 'served' where id = o1_id;      -- placed -> served
    raise exception '5: placed -> served should have been rejected';
  exception when check_violation then null;
  end;
  begin
    update orders set status = 'ready' where id = o1_id;       -- placed -> ready
    raise exception '5: placed -> ready should have been rejected';
  exception when check_violation then null;
  end;

  update orders set status = 'preparing' where id = o1_id;
  update orders set status = 'ready'     where id = o1_id;
  update orders set status = 'served'    where id = o1_id;

  begin
    update orders set status = 'cancelled' where id = o1_id;   -- served -> cancelled
    raise exception '5: served -> cancelled should have been rejected';
  exception when check_violation then null;
  end;

  update orders set status = 'cancelled' where id = o2_id;     -- placed -> cancelled is legal
  raise notice 'PASS 5  state machine: legal transitions allowed, others rejected';

  -- 6. every transition is audited --------------------------------------------
  select count(*) into n from order_status_events where order_id = o1_id;
  assert n = 4, '6: expected 4 status events (placed + 3 transitions), got ' || n;
  assert (select to_status from order_status_events
           where order_id = o1_id order by created_at desc, id desc limit 1) = 'served',
    '6: last event should be served';
  raise notice 'PASS 6  status transitions are audited';

  -- 7. order item snapshots do not drift with the menu ------------------------
  insert into order_items (order_id, menu_item_id, name_at_order, price_at_order, quantity, special_instructions)
  values (o1_id, m_id, 'Test Chai', 30.00, 2, 'extra ginger, less sugar');

  update menu_items set price = 45.00, name = 'Test Chai (Large)' where id = m_id;

  select price_at_order, line_total into amt, n from order_items where order_id = o1_id;
  assert amt = 30.00, '7: price_at_order drifted to ' || amt;
  assert (select line_total from order_items where order_id = o1_id) = 60.00,
    '7: line_total should be 60.00';
  assert (select name_at_order from order_items where order_id = o1_id) = 'Test Chai',
    '7: name_at_order drifted';
  raise notice 'PASS 7  price/name snapshot survives a menu edit';

  -- 8. soft-deleted and 86'd items leave the public menu ----------------------
  update menu_items set is_available = false where id = m_id;
  select count(*) into n from menu_items
   where restaurant_id = r_id and deleted_at is null and is_available;
  assert n = 0, '8: 86-d item should be out of the public menu';

  update menu_items set is_available = true, deleted_at = now() where id = m_id;
  select count(*) into n from menu_items
   where restaurant_id = r_id and deleted_at is null and is_available;
  assert n = 0, '8: soft-deleted item should be out of the public menu';
  assert (select count(*) from order_items where menu_item_id = m_id) = 1,
    '8: order history must survive a menu delete';
  update menu_items set deleted_at = null where id = m_id;
  raise notice 'PASS 8  availability + soft delete hide items without losing history';

  -- 9. payment idempotency -----------------------------------------------------
  insert into payments (restaurant_id, order_id, idempotency_key, method, status, amount)
  values (r_id, o1_id, 'idem-key-abc', 'mock', 'pending', 30.00);
  begin
    insert into payments (restaurant_id, order_id, idempotency_key, method, status, amount)
    values (r_id, o1_id, 'idem-key-abc', 'mock', 'pending', 30.00);
    raise exception '9: duplicate idempotency_key should have been rejected';
  exception when unique_violation then null;
  end;
  raise notice 'PASS 9  duplicate idempotency_key rejected';

  -- 10. at most one successful payment, and it marks the order paid -----------
  assert (select paid_at from orders where id = o1_id) is null, '10: order should start unpaid';

  update payments set status = 'succeeded' where idempotency_key = 'idem-key-abc';
  select paid_at into paid from orders where id = o1_id;
  assert paid is not null, '10: successful payment should set orders.paid_at';

  begin
    insert into payments (restaurant_id, order_id, idempotency_key, method, status, amount)
    values (r_id, o1_id, 'idem-key-def', 'cash', 'succeeded', 30.00);
    raise exception '10: second successful payment should have been rejected';
  exception when unique_violation then null;
  end;
  -- a *failed* second attempt is fine
  insert into payments (restaurant_id, order_id, idempotency_key, method, status, amount)
  values (r_id, o1_id, 'idem-key-ghi', 'card', 'failed', 30.00);
  raise notice 'PASS 10 one successful payment per order; paid_at synced';

  -- 11. RLS is on everywhere ---------------------------------------------------
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert n = 0, '11: ' || n || ' public table(s) have RLS disabled';
  raise notice 'PASS 11 row level security enabled on every public table';

  raise notice '--- all schema invariants hold ---';
end;
$$;

rollback;
