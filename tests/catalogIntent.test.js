import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCatalogIntent } from '../src/domain/catalogIntent.js';

const restaurants = [{ id: 'northstar-kitchen', name: 'Northstar Kitchen', items: [
  { id: 'northstar-grain-bowl', name: 'Northstar Grain Bowl' },
  { id: 'crispy-chickpea-bowl', name: 'Crispy Chickpea Bowl' },
] }];

test('parser proposes catalog-backed order, quantity, modifier, checkout, and cancellation actions', () => {
  assert.deepEqual(parseCatalogIntent('Get two Northstar Grain Bowls from Northstar Kitchen', null, restaurants), {
    type: 'start_order', itemId: 'northstar-grain-bowl', quantity: 2,
  });
  assert.deepEqual(parseCatalogIntent('make it 3', { itemId: 'northstar-grain-bowl' }, restaurants), { type: 'set_quantity', quantity: 3 });
  assert.deepEqual(parseCatalogIntent('checkout', { itemId: 'northstar-grain-bowl' }, restaurants), { type: 'checkout' });
  assert.deepEqual(parseCatalogIntent('cancel order', { itemId: 'northstar-grain-bowl' }, restaurants), { type: 'cancel' });
  assert.deepEqual(parseCatalogIntent('what is popular?', null, restaurants), { type: 'unknown' });
});
