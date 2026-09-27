-- =============================================================================
-- Demo seed: one cafe, four tables, a small menu.
-- Safe to re-run: keyed off a fixed restaurant id.
-- =============================================================================

insert into public.restaurants (id, name, slug, currency_code)
values ('11111111-1111-1111-1111-111111111111', 'Chai Point Cafe', 'chai-point', 'INR')
on conflict (id) do nothing;

insert into public.restaurant_tables (restaurant_id, label, seats)
select '11111111-1111-1111-1111-111111111111', label, seats
from (values ('T1', 2), ('T2', 4), ('T3', 4), ('T4', 6)) as t(label, seats)
on conflict (restaurant_id, label) do nothing;

insert into public.menu_categories (restaurant_id, name, display_order)
select '11111111-1111-1111-1111-111111111111', name, display_order
from (values
  ('Beverages', 10),
  ('Snacks',    20),
  ('Mains',     30),
  ('Desserts',  40)
) as c(name, display_order)
on conflict do nothing;

insert into public.menu_items (restaurant_id, name, description, category_id, price, is_veg, sort_order)
select '11111111-1111-1111-1111-111111111111', m.name, m.description, c.id, m.price, m.is_veg, m.sort_order
from (values
  ('Masala Chai',        'Cutting chai, brewed strong with ginger and cardamom', 'Beverages', 30.00,  true,  10),
  ('Filter Coffee',      'South Indian filter coffee, served hot',               'Beverages', 40.00,  true,  20),
  ('Cold Coffee',        'Blended with ice cream',                               'Beverages', 90.00,  true,  30),
  ('Fresh Lime Soda',    'Sweet, salted, or mixed',                              'Beverages', 50.00,  true,  40),
  ('Veg Sandwich',       'Grilled, with mint chutney',                           'Snacks',    80.00,  true,  10),
  ('Paneer Tikka Roll',  'Tandoori paneer in a soft roll',                       'Snacks',   140.00,  true,  20),
  ('Chicken Puff',       'Flaky pastry, spiced chicken filling',                 'Snacks',    70.00,  false, 30),
  ('Samosa (2 pcs)',     'Served with tamarind chutney',                         'Snacks',    40.00,  true,  40),
  ('Maggi Masala',       'The hostel classic',                                   'Mains',     60.00,  true,  10),
  ('Veg Fried Rice',     'Wok-tossed with seasonal vegetables',                  'Mains',    150.00,  true,  20),
  ('Butter Chicken Bowl','With two butter rotis',                                'Mains',    240.00,  false, 30),
  ('Chocolate Brownie',  'Served warm',                                          'Desserts', 110.00,  true,  10)
) as m(name, description, category, price, is_veg, sort_order)
join public.menu_categories c
  on c.restaurant_id = '11111111-1111-1111-1111-111111111111' and c.name = m.category
where not exists (
  select 1 from public.menu_items existing
  where existing.restaurant_id = '11111111-1111-1111-1111-111111111111'
    and existing.name = m.name
);

-- Show the QR tokens you'll need for GET /menu/:qr_token
select t.label, t.qr_token
from public.restaurant_tables t
where t.restaurant_id = '11111111-1111-1111-1111-111111111111'
order by t.label;

-- -----------------------------------------------------------------------------
-- After you sign a staff user up through Supabase Auth, link them to the cafe:
--
--   insert into public.staff_members (user_id, restaurant_id, role, display_name)
--   values ('<auth.users.id>', '11111111-1111-1111-1111-111111111111', 'owner', 'Owner');
-- -----------------------------------------------------------------------------
