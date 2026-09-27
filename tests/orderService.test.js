import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderService } from '../src/application/orderService.js';

test('order service validates revisions and edit payloads before repository calls', () => {
  const calls = [];
  const service = createOrderService({
    catalog: { findItem: () => ({ id: 'bowl' }) },
    orders: { edit: (input) => { calls.push(input); return input; } },
  });
  assert.throws(() => service.editLine({ userId: 'buyer', orderId: 'o', expectedRevision: 0, quantity: 1 }), { code: 'invalid_order' });
  assert.throws(() => service.editLine({ userId: 'buyer', orderId: 'o', expectedRevision: 1 }), { code: 'invalid_order' });
  assert.throws(() => service.editLine({ userId: 'buyer', orderId: 'o', expectedRevision: 1, quantity: 21 }), { code: 'invalid_order' });
  assert.throws(() => service.editLine({ userId: 'buyer', orderId: 'o', expectedRevision: 1, modifierIds: 'not-an-array' }), { code: 'invalid_order' });
  const result = service.editLine({ userId: 'buyer', orderId: 'o', lineItemId: 'line', expectedRevision: 2, quantity: 3 });
  assert.equal(result.userId, 'buyer');
  assert.equal(calls.length, 1);
});

test('order service resolves active catalog items before adding them to a cart', () => {
  let resolved = 0;
  let added;
  const service = createOrderService({
    catalog: { findItem: (id) => { resolved += 1; return id === 'bowl' ? { id } : null; } },
    orders: { addItem: (input) => { added = input; return input; } },
  });
  assert.throws(() => service.addMenuItem({ userId: 'buyer', orderId: 'order', itemId: 'missing', expectedRevision: 1 }), { code: 'item_unavailable' });
  assert.throws(() => service.addMenuItem({ userId: 'buyer', orderId: 'order', itemId: 'bowl', expectedRevision: 1, quantity: 0 }), { code: 'invalid_order' });
  service.addMenuItem({ userId: 'buyer', orderId: 'order', itemId: 'bowl', expectedRevision: 2, quantity: 2 });
  assert.equal(resolved, 2);
  assert.deepEqual(added.item, { id: 'bowl' });
  assert.equal(added.quantity, 2);
});

test('order cancellation and line removal preserve account and revision context', () => {
  let canceled;
  let removed;
  const service = createOrderService({
    catalog: { findItem: () => null },
    orders: {
      cancel: (input) => { canceled = input; return { status: 'canceled' }; },
      removeItem: (input) => { removed = input; return null; },
    },
  });
  service.cancel({ userId: 'buyer', orderId: 'order', expectedRevision: 4 });
  service.removeLine({ userId: 'buyer', orderId: 'order', lineItemId: 'line', expectedRevision: 5 });
  assert.deepEqual(canceled, { userId: 'buyer', orderId: 'order', expectedRevision: 4 });
  assert.deepEqual(removed, { userId: 'buyer', orderId: 'order', lineItemId: 'line', expectedRevision: 5 });
});
