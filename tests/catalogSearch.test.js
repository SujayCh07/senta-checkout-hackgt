import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCatalog } from '../src/domain/catalogSearch.js';

const catalog = [
  { id: 'northstar', name: 'Northstar Kitchen', items: [
    { id: 'grain-bowl', name: 'Northstar Grain Bowl', priceCents: 1250 },
    { id: 'chickpea-bowl', name: 'Crispy Chickpea Bowl', priceCents: 1100 },
    { id: 'salad', name: 'Lemon Tahini Salad', priceCents: 1050 },
  ] },
  { id: 'south', name: 'South Cafe', items: [{ id: 'rice-bowl', name: 'Rice Bowl', priceCents: 950 }] },
];

test('catalog search ranks exact, prefix, phrase, and token matches deterministically', () => {
  assert.equal(searchCatalog(catalog, 'northstar grain bowl')[0].id, 'grain-bowl');
  assert.equal(searchCatalog(catalog, 'bowl')[0].id, 'chickpea-bowl');
  assert.equal(searchCatalog(catalog, 'grain')[0].restaurant.name, 'Northstar Kitchen');
});

test('catalog search can scope a restaurant, caps results, and does not invent a match', () => {
  assert.deepEqual(searchCatalog(catalog, 'bowl', { restaurantId: 'south' }).map((item) => item.id), ['rice-bowl']);
  assert.equal(searchCatalog(catalog, 'noodles').length, 0);
  assert.equal(searchCatalog(catalog, 'bowl', { limit: 1 }).length, 1);
  assert.throws(() => searchCatalog(catalog, 'bowl', { limit: 51 }), RangeError);
});
