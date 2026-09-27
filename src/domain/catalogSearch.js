export function searchCatalog(restaurants, query, { restaurantId = null, limit = 12 } = {}) {
  if (!Array.isArray(restaurants)) throw new TypeError('Restaurants must be an array');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError('Catalog result limit must be between 1 and 50');
  const normalizedQuery = normalize(query ?? '');
  if (!normalizedQuery) return [];
  const queryTokens = normalizedQuery.split(' ');
  const matches = [];

  for (const restaurant of restaurants) {
    if (restaurantId && restaurant.id !== restaurantId) continue;
    for (const item of restaurant.items ?? []) {
      const name = normalize(item.name);
      const tokens = name.split(' ');
      let score = 0;
      if (name === normalizedQuery) score = 100;
      else if (name.startsWith(normalizedQuery)) score = 80;
      else if (name.includes(normalizedQuery)) score = 60;
      else if (queryTokens.every((token) => tokens.some((itemToken) => itemToken.startsWith(token)))) score = 45;
      else if (queryTokens.some((token) => tokens.some((itemToken) => itemToken.startsWith(token)))) score = 20;
      if (score > 0) matches.push({ item, restaurant: { id: restaurant.id, name: restaurant.name }, score });
    }
  }

  return matches
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
    .slice(0, limit)
    .map(({ item, restaurant }) => ({ ...item, restaurant }));
}

export function normalizeCatalogQuery(value) {
  if (typeof value !== 'string') return '';
  return normalize(value);
}

function normalize(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim();
}
