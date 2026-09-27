import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCheckoutService } from '../src/application/checkoutService.js';
import { openDatabase } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';
import { createCatalogRepository } from '../src/persistence/catalogRepository.js';
import { createOrderRepository } from '../src/persistence/orderRepository.js';
import { createPaymentRepository } from '../src/persistence/paymentRepository.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'senta-checkout-service-'));
  const db = openDatabase({ path: join(directory, 'checkout.sqlite') });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  runMigrations(db);
  db.prepare("INSERT INTO users (id, email, password_salt, password_hash, created_at) VALUES ('buyer', 'buyer@example.test', 'salt', 'hash', 1)").run();
  const catalog = createCatalogRepository(db);
  const orders = createOrderRepository(db, { catalog });
  const payments = createPaymentRepository(db);
  const order = orders.create({ userId: 'buyer', item: catalog.findItem('northstar-grain-bowl'), quantity: 2, modifierIds: ['grain-bowl-chicken'] });
  return { db, catalog, order, orders, payments };
}

test('checkout service uses order snapshot pricing and hands off only to a provider URL', async (t) => {
  const { order, orders, payments, catalog } = await fixture(t);
  let request;
  const service = createCheckoutService({ orders, payments, catalog, provider: { createCheckout: async (input) => { request = input; return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }; } } });
  const result = await service.createCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1 });
  assert.equal(result.status, 'open');
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(request.order.totalCents, 3100);
  assert.equal(request.order.unitPriceCents, 1550);
  assert.match(request.idempotencyKey, new RegExp(order.id));
  assert.equal(orders.findOwned(order.id, 'buyer').status, 'checkout_pending');
});

test('ambiguous Stripe timeout is persisted and a retry reuses the same idempotency key', async (t) => {
  const { order, orders, payments, catalog } = await fixture(t);
  const keys = [];
  let calls = 0;
  const service = createCheckoutService({ orders, payments, catalog, provider: { createCheckout: async ({ idempotencyKey }) => {
    keys.push(idempotencyKey);
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('timeout'), { code: 'ambiguous_checkout' });
    return { id: 'cs_test_recovered', url: 'https://checkout.stripe.com/c/pay/cs_test_recovered' };
  } } });
  const unknown = await service.createCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1 });
  assert.equal(unknown.status, 'unknown_state');
  const recovered = await service.createCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1 });
  assert.equal(recovered.status, 'open');
  assert.equal(keys[0], keys[1]);
  assert.equal(payments.findForOrder(order.id, 'buyer').status, 'open');
});

test('checkout does not start for another account or for a stale order revision', async (t) => {
  const { order, orders, payments, catalog } = await fixture(t);
  const service = createCheckoutService({ orders, payments, catalog, provider: { createCheckout: async () => { throw new Error('must not call provider'); } } });
  await assert.rejects(service.createCheckout({ userId: 'stranger', orderId: order.id, expectedRevision: 1 }), { code: 'not_found' });
  await assert.rejects(service.createCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 2 }), { code: 'revision_conflict' });
});

test('checkout rejects a changed catalog price or unavailable item before contacting Stripe', async (t) => {
  const { db, order, orders, payments, catalog } = await fixture(t);
  let called = false;
  const service = createCheckoutService({ orders, payments, catalog, provider: { createCheckout: async () => { called = true; } } });
  db.prepare("UPDATE menu_items SET price_cents = 1300 WHERE id = 'northstar-grain-bowl'").run();
  await assert.rejects(service.createCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1 }), { code: 'price_changed' });
  db.prepare("UPDATE menu_items SET price_cents = 1250, active = 0 WHERE id = 'northstar-grain-bowl'").run();
  await assert.rejects(service.createCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1 }), { code: 'item_unavailable' });
  assert.equal(called, false);
});

test('known provider rejection restores the cart and a new attempt receives a new idempotency key', async (t) => {
  const { order, orders, payments, catalog } = await fixture(t);
  const keys = [];
  let call = 0;
  const service = createCheckoutService({ orders, payments, catalog, provider: { createCheckout: async ({ idempotencyKey }) => {
    keys.push(idempotencyKey);
    call += 1;
    if (call === 1) throw Object.assign(new Error('rejected'), { code: 'stripe_rejected' });
    return { id: 'cs_test_retry', url: 'https://checkout.stripe.com/c/pay/cs_test_retry' };
  } } });
  await assert.rejects(service.createCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1 }), { code: 'stripe_rejected' });
  assert.equal(orders.findOwned(order.id, 'buyer').status, 'ready');
  assert.equal((await service.createCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1 })).status, 'open');
  assert.notEqual(keys[0], keys[1]);
});
