import { searchCatalog } from '../../domain/catalogSearch.js';
import { sendJson } from '../responses.js';

export function createCatalogRoutes({ catalog }) {
  return function handleCatalogRoute(request, response, url) {
    if (request.method !== 'GET' || url.pathname !== '/api/catalog') return false;
    const query = url.searchParams.get('q') ?? '';
    const limitValue = url.searchParams.get('limit') ?? '12';
    const restaurantId = url.searchParams.get('restaurant') || null;
    const limit = Number(limitValue);
    if (query.length > 100 || !/^\d+$/.test(limitValue) || limit < 1 || limit > 50) {
      sendJson(response, 400, { error: 'Catalog query must be under 100 characters and limit must be between 1 and 50.', code: 'invalid_catalog_query' });
      return true;
    }
    const restaurants = catalog.listActive();
    const result = query.trim()
      ? { items: searchCatalog(restaurants, query, { restaurantId, limit }) }
      : { restaurants };
    sendJson(response, 200, result, { 'cache-control': 'public, max-age=60' });
    return true;
  };
}
