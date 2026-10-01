// What a brand-new café starts with: a few categories and sample dishes, so the
// menu, POS and the customer's QR page have something to show on first open
// instead of three empty screens. All of it is editable or deletable like
// anything the owner adds. Mirrors the demo seed in supabase/seed.sql; prices
// are in rupees, the default currency, and are placeholders either way.
export const STARTER_MENU = [
  {
    category: 'Beverages',
    items: [
      ['Masala Chai', 'Cutting chai, brewed strong with ginger and cardamom', 30, true],
      ['Filter Coffee', 'South Indian filter coffee, served hot', 40, true],
      ['Cold Coffee', 'Blended with ice cream', 90, true],
      ['Fresh Lime Soda', 'Sweet, salted, or mixed', 50, true],
    ],
  },
  {
    category: 'Snacks',
    items: [
      ['Veg Sandwich', 'Grilled, with mint chutney', 80, true],
      ['Paneer Tikka Roll', 'Tandoori paneer in a soft roll', 140, true],
      ['Chicken Puff', 'Flaky pastry, spiced chicken filling', 70, false],
      ['Samosa (2 pcs)', 'Served with tamarind chutney', 40, true],
    ],
  },
  {
    category: 'Mains',
    items: [
      ['Maggi Masala', 'The hostel classic', 60, true],
      ['Veg Fried Rice', 'Wok-tossed with seasonal vegetables', 150, true],
      ['Butter Chicken Bowl', 'With two butter rotis', 240, false],
    ],
  },
  {
    category: 'Desserts',
    items: [['Chocolate Brownie', 'Served warm', 110, true]],
  },
];

// Inside the caller's transaction, so a café is never left half-seeded.
export async function insertStarterMenu(tx, restaurantId) {
  for (const [i, { category, items }] of STARTER_MENU.entries()) {
    const { rows } = await tx.query(
      `insert into public.menu_categories (restaurant_id, name, display_order)
       values ($1, $2, $3) returning id`,
      [restaurantId, category, (i + 1) * 10],
    );
    for (const [j, [name, description, price, isVeg]] of items.entries()) {
      await tx.query(
        `insert into public.menu_items (restaurant_id, name, description, category_id, price, is_veg, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [restaurantId, name, description, rows[0].id, price, isVeg, (j + 1) * 10],
      );
    }
  }
}
