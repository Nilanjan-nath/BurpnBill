import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb, RESTAURANT_ID } from './helpers/testDb.js';

// Menu categories and item photos, on real Postgres (PGlite) with the repo's
// own migrations and seed. Supabase Storage is the one thing faked here — the
// fake records what it was asked to do, so the tests can assert that a replaced
// photo's file is actually cleaned up rather than quietly orphaned.

const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CAFE_OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db;
let server;
let base;
let otherRestaurantId;
let storage;

before(async () => {
  db = await createTestDb();
  const supabase = {
    auth: {
      async getUser(token) {
        return token.startsWith('valid-')
          ? { data: { user: { id: token.slice(6) } }, error: null }
          : { data: null, error: new Error('bad token') };
      },
    },
  };

  storage = {
    uploads: [],
    removed: [],
    async upload({ restaurantId, itemId, bytes, contentType }) {
      this.uploads.push({ restaurantId, itemId, bytes: bytes.length, contentType });
      return `https://example.test/storage/v1/object/public/menu-images/${restaurantId}/${itemId}-${this.uploads.length}.png`;
    },
    async remove(url) {
      this.removed.push(url);
      return true;
    },
  };

  const app = createApp({
    config: { appBaseUrl: 'http://localhost:5173', guestSessionTtlHours: 3 },
    db,
    supabase,
    imageStore: storage,
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;

  const { rows } = await db.query(`insert into restaurants (name) values ('Other Cafe') returning id`);
  otherRestaurantId = rows[0].id;

  await db.query(
    `insert into staff_members (user_id, restaurant_id, role, display_name) values
       ($1, $3, 'owner', 'Mita'), ($2, $3, 'staff', 'Ravi'), ($4, $5, 'owner', 'Rival')`,
    [OWNER, STAFF, RESTAURANT_ID, OTHER_CAFE_OWNER, otherRestaurantId],
  );
});

after(async () => {
  server.close();
  await db.close();
});

async function call(method, path, { as, body, raw, contentType } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': contentType ?? 'application/json',
      ...(as && { Authorization: `Bearer valid-${as}` }),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const listCategories = (as) => call('GET', '/api/categories', { as });
const categoryNamed = async (name) =>
  (await db.query('select * from menu_categories where restaurant_id = $1 and name = $2', [RESTAURANT_ID, name])).rows[0];

// --- GET /categories ---------------------------------------------------------

test('needs a signed-in staff member; a café only ever sees its own categories', async () => {
  assert.equal((await call('GET', '/api/categories')).status, 401);

  const ours = (await listCategories(STAFF)).body.categories;
  assert.deepEqual(ours.map((c) => c.name), ['Beverages', 'Snacks', 'Mains', 'Desserts']);
  assert.deepEqual((await listCategories(OTHER_CAFE_OWNER)).body.categories, []);
});

test('categories read in display_order, not alphabetically, and carry a live item count', async () => {
  const ours = (await listCategories(OWNER)).body.categories;
  assert.deepEqual(ours.map((c) => c.display_order), [10, 20, 30, 40]);
  assert.equal(ours.find((c) => c.name === 'Beverages').item_count, 4);
  assert.equal(ours.find((c) => c.name === 'Desserts').item_count, 1);

  // A category holding nothing but deleted items reads as empty — that is what
  // the owner sees on the menu.
  await db.query(`update menu_items set deleted_at = now() where name = 'Chocolate Brownie'`);
  try {
    const after = (await listCategories(OWNER)).body.categories;
    assert.equal(after.find((c) => c.name === 'Desserts').item_count, 0);
  } finally {
    await db.query(`update menu_items set deleted_at = null where name = 'Chocolate Brownie'`);
  }
});

// --- POST /categories --------------------------------------------------------

test('creating a category is owner only, and validates the input', async () => {
  assert.equal((await call('POST', '/api/categories', { body: { name: 'Combos' } })).status, 401);
  assert.equal((await call('POST', '/api/categories', { as: STAFF, body: { name: 'Combos' } })).status, 403);

  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(61) }, { name: 'Combos', display_order: -1 }, { name: 'Combos', extra: true }]) {
    assert.equal((await call('POST', '/api/categories', { as: OWNER, body })).status, 400, JSON.stringify(body));
  }
});

test('a new category lands at the end of the menu, not on top of an existing one', async () => {
  const res = await call('POST', '/api/categories', { as: OWNER, body: { name: 'Combos' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.category.display_order, 50); // after Desserts at 40
  assert.equal(res.body.category.item_count, 0);

  const names = (await listCategories(OWNER)).body.categories.map((c) => c.name);
  assert.equal(names.at(-1), 'Combos');

  await db.query('delete from menu_categories where name = $1', ['Combos']);
});

test('a category can exist before anything is in it — the whole point of it being a record', async () => {
  const res = await call('POST', '/api/categories', { as: OWNER, body: { name: 'Desserts To Come', display_order: 5 } });
  assert.equal(res.status, 201);
  assert.equal(res.body.category.item_count, 0);
  assert.equal((await listCategories(OWNER)).body.categories[0].name, 'Desserts To Come');

  await db.query('delete from menu_categories where name = $1', ['Desserts To Come']);
});

test('the same category name twice is a 409; the same name at another café is fine', async () => {
  assert.equal((await call('POST', '/api/categories', { as: OWNER, body: { name: 'Beverages' } })).status, 409);
  // Case and stray whitespace are the same category to everyone except a database.
  assert.equal((await call('POST', '/api/categories', { as: OWNER, body: { name: '  beverages ' } })).status, 409);

  const theirs = await call('POST', '/api/categories', { as: OTHER_CAFE_OWNER, body: { name: 'Beverages' } });
  assert.equal(theirs.status, 201);
  await db.query('delete from menu_categories where restaurant_id = $1', [otherRestaurantId]);
});

// --- PATCH /categories/:id ---------------------------------------------------

test('renaming and reordering are owner only, and leave the items alone', async () => {
  const beverages = await categoryNamed('Beverages');

  assert.equal((await call('PATCH', `/api/categories/${beverages.id}`, { as: STAFF, body: { name: 'Drinks' } })).status, 403);
  assert.equal((await call('PATCH', `/api/categories/${beverages.id}`, { as: OWNER, body: {} })).status, 400);

  const res = await call('PATCH', `/api/categories/${beverages.id}`, { as: OWNER, body: { name: 'Drinks', display_order: 15 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.category.name, 'Drinks');
  assert.equal(res.body.category.display_order, 15);

  // Four items moved with it without being touched — they point at the record.
  assert.equal(res.body.category.item_count, 4);
  const items = (await call('GET', '/api/items', { as: OWNER })).body.items;
  assert.equal(items.find((i) => i.name === 'Masala Chai').category, 'Drinks');

  await call('PATCH', `/api/categories/${beverages.id}`, { as: OWNER, body: { name: 'Beverages', display_order: 10 } });
});

test('a made-up id is 404, another café\'s category is 404 rather than a peek', async () => {
  assert.equal((await call('PATCH', '/api/categories/99999999-9999-4999-8999-999999999999', { as: OWNER, body: { name: 'X' } })).status, 404);
  assert.equal((await call('PATCH', '/api/categories/not-a-uuid', { as: OWNER, body: { name: 'X' } })).status, 400);

  const beverages = await categoryNamed('Beverages');
  assert.equal((await call('PATCH', `/api/categories/${beverages.id}`, { as: OTHER_CAFE_OWNER, body: { name: 'Stolen' } })).status, 404);
});

// --- DELETE /categories/:id --------------------------------------------------

test('deleting a category moves its food to Uncategorised — it never deletes the food', async () => {
  const snacks = await categoryNamed('Snacks');

  assert.equal((await call('DELETE', `/api/categories/${snacks.id}`, { as: STAFF })).status, 403);

  const res = await call('DELETE', `/api/categories/${snacks.id}`, { as: OWNER });
  assert.equal(res.status, 200);
  assert.equal(res.body.moved_items, 4);

  const items = (await call('GET', '/api/items', { as: OWNER })).body.items;
  const samosa = items.find((i) => i.name === 'Samosa (2 pcs)');
  assert.ok(samosa, 'the item survives its category');
  assert.equal(samosa.category, 'Uncategorised');
  assert.equal(samosa.category_id, null);

  // And it is still orderable by a customer, under Uncategorised.
  const { rows } = await db.query('select qr_token from restaurant_tables limit 1');
  const menu = await call('GET', `/api/menu/${rows[0].qr_token}`);
  const uncategorised = menu.body.categories.find((c) => c.name === 'Uncategorised');
  assert.ok(uncategorised.items.some((i) => i.name === 'Samosa (2 pcs)'));
  // Uncategorised sorts after everything the owner deliberately placed.
  assert.equal(menu.body.categories.at(-1).name, 'Uncategorised');

  await db.query(`insert into menu_categories (id, restaurant_id, name, display_order) values ($1, $2, 'Snacks', 20)`, [snacks.id, RESTAURANT_ID]);
  await db.query(`update menu_items set category_id = $1 where restaurant_id = $2 and name in
    ('Veg Sandwich', 'Paneer Tikka Roll', 'Chicken Puff', 'Samosa (2 pcs)')`, [snacks.id, RESTAURANT_ID]);
});

test('a deleted category also lets go of soft-deleted items, which the foreign key still counts', async () => {
  const { rows } = await db.query(
    `insert into menu_categories (restaurant_id, name, display_order) values ($1, 'Seasonal', 99) returning id`,
    [RESTAURANT_ID],
  );
  const seasonal = rows[0].id;
  await db.query(
    `insert into menu_items (restaurant_id, name, price, category_id, deleted_at) values ($1, 'Mango Lassi', 80, $2, now())`,
    [RESTAURANT_ID, seasonal],
  );

  const res = await call('DELETE', `/api/categories/${seasonal}`, { as: OWNER });
  assert.equal(res.status, 200);
  assert.equal(res.body.moved_items, 0, 'a deleted item is not something the owner moved');

  const { rows: gone } = await db.query('select count(*)::int n from menu_categories where id = $1', [seasonal]);
  assert.equal(gone[0].n, 0, 'the category is actually deleted, not blocked by the invisible row');

  await db.query(`delete from menu_items where name = 'Mango Lassi'`);
});

// --- items and their category ------------------------------------------------

test('an item can be created into a category, moved between them, and cleared to Uncategorised', async () => {
  const mains = await categoryNamed('Mains');
  const created = await call('POST', '/api/items', { as: OWNER, body: { name: 'Thali', price: 180, category_id: mains.id } });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.category, 'Mains');

  const beverages = await categoryNamed('Beverages');
  const moved = await call('PATCH', `/api/items/${created.body.item.id}`, { as: OWNER, body: { category_id: beverages.id } });
  assert.equal(moved.body.item.category, 'Beverages');

  // Sending null clears it; leaving it out would have kept Beverages.
  const cleared = await call('PATCH', `/api/items/${created.body.item.id}`, { as: OWNER, body: { category_id: null } });
  assert.equal(cleared.body.item.category, 'Uncategorised');
  assert.equal(cleared.body.item.category_id, null);

  const kept = await call('PATCH', `/api/items/${created.body.item.id}`, { as: OWNER, body: { price: 190 } });
  assert.equal(kept.body.item.category, 'Uncategorised', 'an omitted category is not a cleared one');

  await db.query('delete from menu_items where id = $1', [created.body.item.id]);
});

test('an item cannot be filed under another café\'s category', async () => {
  const { rows } = await db.query(
    `insert into menu_categories (restaurant_id, name) values ($1, 'Their Section') returning id`,
    [otherRestaurantId],
  );
  const res = await call('POST', '/api/items', { as: OWNER, body: { name: 'Sneaky', price: 10, category_id: rows[0].id } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_reference');

  await db.query('delete from menu_categories where id = $1', [rows[0].id]);
});

// --- PUT /items/:id/image ----------------------------------------------------

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const itemNamed = async (name) =>
  (await db.query('select * from menu_items where restaurant_id = $1 and name = $2', [RESTAURANT_ID, name])).rows[0];

test('uploading a photo is owner only, and refuses anything that is not an image we render', async () => {
  const chai = await itemNamed('Masala Chai');
  const png = { raw: PNG, contentType: 'image/png' };

  assert.equal((await call('PUT', `/api/items/${chai.id}/image`, png)).status, 401);
  assert.equal((await call('PUT', `/api/items/${chai.id}/image`, { as: STAFF, ...png })).status, 403);
  assert.equal((await call('PUT', `/api/items/${chai.id}/image`, { as: OTHER_CAFE_OWNER, ...png })).status, 404);

  // A PDF renamed to .png is still a PDF; the content type is what we go on.
  const wrongType = await call('PUT', `/api/items/${chai.id}/image`, { as: OWNER, raw: PNG, contentType: 'application/pdf' });
  assert.equal(wrongType.status, 415);

  const empty = await call('PUT', `/api/items/${chai.id}/image`, { as: OWNER, raw: Buffer.alloc(0), contentType: 'image/png' });
  assert.equal(empty.status, 400);
});

test('an uploaded photo reaches the item, the customer menu, and nothing else', async () => {
  const chai = await itemNamed('Masala Chai');
  const before = storage.uploads.length;

  const res = await call('PUT', `/api/items/${chai.id}/image`, { as: OWNER, raw: PNG, contentType: 'image/png' });
  assert.equal(res.status, 200);
  assert.ok(res.body.item.image_url.includes('menu-images/'));
  assert.equal(res.body.item.replaced_image_url, undefined, 'the previous URL is an internal detail, not part of the response');

  const upload = storage.uploads.at(-1);
  assert.equal(storage.uploads.length, before + 1);
  assert.equal(upload.restaurantId, RESTAURANT_ID, 'filed under the café that owns the item');
  assert.equal(upload.contentType, 'image/png');
  assert.equal(upload.bytes, PNG.length);

  const { rows } = await db.query('select qr_token from restaurant_tables limit 1');
  const menu = await call('GET', `/api/menu/${rows[0].qr_token}`);
  const onMenu = menu.body.categories.flatMap((c) => c.items).find((i) => i.name === 'Masala Chai');
  assert.equal(onMenu.image_url, res.body.item.image_url, 'the photo the owner uploaded is the one a customer sees');
});

test('replacing a photo deletes the file it replaced, rather than orphaning it', async () => {
  const chai = await itemNamed('Masala Chai');
  const first = chai.image_url;
  assert.ok(first, 'set up by the previous test');

  const res = await call('PUT', `/api/items/${chai.id}/image`, { as: OWNER, raw: PNG, contentType: 'image/png' });
  assert.notEqual(res.body.item.image_url, first, 'a new path, so a cached copy of the old one cannot win');
  assert.ok(storage.removed.includes(first), 'the replaced file is gone from the bucket');
});

test('removing a photo clears the column and the file; deleting the item does both too', async () => {
  const chai = await itemNamed('Masala Chai');
  const url = chai.image_url;

  const cleared = await call('DELETE', `/api/items/${chai.id}/image`, { as: OWNER });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.item.image_url, null);
  assert.ok(storage.removed.includes(url));

  const created = await call('POST', '/api/items', { as: OWNER, body: { name: 'Short Lived', price: 10 } });
  const uploaded = await call('PUT', `/api/items/${created.body.item.id}/image`, { as: OWNER, raw: PNG, contentType: 'image/png' });
  await call('DELETE', `/api/items/${created.body.item.id}`, { as: OWNER });
  assert.ok(storage.removed.includes(uploaded.body.item.image_url), 'a deleted item leaves no file behind');
});
