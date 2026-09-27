export function createCatalogRepository(db) {
  const listRestaurants = db.prepare(`
    SELECT id, slug, name FROM restaurants WHERE active = 1 ORDER BY name COLLATE NOCASE
  `);
  const listMenuItems = db.prepare(`
    SELECT m.id, m.restaurant_id AS restaurantId, m.name, m.description,
           m.price_cents AS priceCents, m.currency, m.catalog_version AS catalogVersion
    FROM menu_items m JOIN restaurants r ON r.id = m.restaurant_id
    WHERE r.active = 1 AND m.active = 1 ORDER BY m.name COLLATE NOCASE
  `);
  const listModifiers = db.prepare(`
    SELECT id, menu_item_id AS menuItemId, name, price_delta_cents AS priceDeltaCents,
           required, active
    FROM modifiers WHERE menu_item_id = ? AND active = 1 ORDER BY name COLLATE NOCASE
  `);
  const findItem = db.prepare(`
    SELECT m.id, m.restaurant_id AS restaurantId, r.name AS restaurantName,
           m.name, m.description, m.price_cents AS priceCents, m.currency,
           m.catalog_version AS catalogVersion
    FROM menu_items m JOIN restaurants r ON r.id = m.restaurant_id
    WHERE m.id = ? AND m.active = 1 AND r.active = 1
  `);

  function attachModifiers(item) {
    return item && { ...item, modifiers: listModifiers.all(item.id).map(normalizeModifier) };
  }

  return Object.freeze({
    listActive() {
      const restaurants = listRestaurants.all().map((row) => ({ ...row, items: [] }));
      const byId = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
      for (const row of listMenuItems.all()) {
        const restaurant = byId.get(row.restaurantId);
        if (restaurant) restaurant.items.push(attachModifiers(row));
      }
      return restaurants;
    },
    findItem(id) {
      const row = findItem.get(id);
      return row ? { ...row, modifiers: listModifiers.all(id).map(normalizeModifier) } : null;
    },
    findItemByName(query, restaurantId) {
      if (typeof query !== 'string' || !query.trim()) return null;
      const needle = query.normalize('NFKC').trim().toLocaleLowerCase('en-US');
      return this.listActive()
        .filter((restaurant) => !restaurantId || restaurant.id === restaurantId)
        .flatMap((restaurant) => restaurant.items)
        .find((item) => item.name.toLocaleLowerCase('en-US') === needle) ?? null;
    },
  });
}

function normalizeModifier(row) {
  return { ...row, required: row.required === 1, active: row.active === 1 };
}
