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

test('parser handles numeric and word quantities, plurals, supported options, and range boundaries', () => {
  assert.deepEqual(parseCatalogIntent('Get 20 Northstar Grain Bowls', null, restaurants), {
    type: 'start_order', itemId: 'northstar-grain-bowl', quantity: 20,
  });
  assert.deepEqual(parseCatalogIntent('Get 21 Northstar Grain Bowls', null, restaurants), {
    type: 'start_order', itemId: 'northstar-grain-bowl', quantity: 21,
  });
  assert.deepEqual(parseCatalogIntent('Make it 21', { itemId: 'northstar-grain-bowl' }, restaurants), {
    type: 'invalid_quantity', quantity: 21,
  });
  assert.deepEqual(parseCatalogIntent('set quantity to one', { itemId: 'northstar-grain-bowl' }, restaurants), {
    type: 'set_quantity', quantity: 1,
  });
});

test('parser maps available modifier language to a selected modifier set and ignores unrelated options', () => {
  const item = {
    ...restaurants[0].items[0],
    modifiers: [
      { id: 'chicken', name: 'Add grilled chicken', active: true },
      { id: 'tofu', name: 'Add tofu', active: true },
    ],
  };
  const menu = [{ ...restaurants[0], items: [item] }];
  const order = { itemId: item.id, modifierIds: [] };
  assert.deepEqual(parseCatalogIntent('add grilled chicken', order, menu), { type: 'set_modifiers', modifierIds: ['chicken'] });
  assert.deepEqual(parseCatalogIntent('remove grilled chicken', { ...order, modifierIds: ['chicken'] }, menu), { type: 'set_modifiers', modifierIds: [] });
  assert.deepEqual(parseCatalogIntent('add extra cheese', order, menu), { type: 'unknown' });
});
