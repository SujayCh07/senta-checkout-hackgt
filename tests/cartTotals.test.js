import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCartTotals, calculateOrderTotals } from '../src/domain/cart.js';

const bowl = {
  id: 'bowl', name: 'Grain Bowl', priceCents: 1250, currency: 'USD',
  modifiers: [
    { id: 'chicken', name: 'Add chicken', priceDeltaCents: 300, required: false, active: true },
    { id: 'tofu', name: 'Add tofu', priceDeltaCents: 150, required: false, active: true },
  ],
};
const salad = { id: 'salad', name: 'Garden Salad', priceCents: 900, currency: 'USD', modifiers: [] };

test('single-line totals use integer cents and include selected option prices per quantity', () => {
  assert.deepEqual(calculateOrderTotals(bowl, 2, ['chicken']), {
    currency: 'USD', quantity: 2, unitPriceCents: 1550, lineTotalCents: 3100,
    subtotalCents: 3100, totalCents: 3100,
    modifiers: [{ id: 'chicken', name: 'Add chicken', priceDeltaCents: 300 }],
  });
});

test('cart totals aggregate distinct lines and preserve individual item breakdowns', () => {
  const cart = calculateCartTotals([
    { item: bowl, quantity: 2, modifierIds: ['tofu'] },
    { item: salad, quantity: 1 },
  ]);
  assert.equal(cart.subtotalCents, 3700);
  assert.equal(cart.totalCents, 3700);
  assert.deepEqual(cart.lineItems.map((line) => line.totalCents), [2800, 900]);
});

test('invalid quantities, duplicate/unavailable modifiers, mixed currencies, and oversized carts fail closed', () => {
  for (const quantity of [0, -1, 1.2, 21]) {
    assert.throws(() => calculateOrderTotals(bowl, quantity), { code: 'invalid_order' });
  }
  assert.throws(() => calculateOrderTotals(bowl, 1, ['chicken', 'chicken']), { code: 'invalid_order' });
  assert.throws(() => calculateOrderTotals(bowl, 1, ['no-such-option']), { code: 'invalid_order' });
  assert.throws(() => calculateCartTotals([{ item: bowl, quantity: 1 }, { item: { ...salad, currency: 'CAD' }, quantity: 1 }]), { code: 'invalid_order' });
  assert.throws(() => calculateCartTotals(Array.from({ length: 51 }, () => ({ item: salad, quantity: 1 }))), { code: 'invalid_order' });
});

test('required options must be selected before totals can be quoted', () => {
  const required = { ...bowl, modifiers: [{ ...bowl.modifiers[0], required: true }] };
  assert.throws(() => calculateOrderTotals(required, 1), /required options/);
  assert.equal(calculateOrderTotals(required, 1, ['chicken']).totalCents, 1550);
});
