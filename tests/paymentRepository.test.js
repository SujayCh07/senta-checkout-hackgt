import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';
import { createCatalogRepository } from '../src/persistence/catalogRepository.js';
import { createOrderRepository } from '../src/persistence/orderRepository.js';
import { createPaymentRepository } from '../src/persistence/paymentRepository.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'senta-payment-repo-'));
  const db = openDatabase({ path: join(directory, 'payment.sqlite') });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  runMigrations(db);
  db.prepare("INSERT INTO users (id, email, password_salt, password_hash, created_at) VALUES ('buyer', 'buyer@example.test', 'salt', 'hash', 1)").run();
  const catalog = createCatalogRepository(db);
  const orders = createOrderRepository(db, { catalog });
  const order = orders.create({ userId: 'buyer', item: catalog.findItem('northstar-grain-bowl'), quantity: 2 });
  return { db, orders, order, payments: createPaymentRepository(db) };
}

test('attempt lifecycle locks an order and stores checkout amount, currency, and idempotency key', async (t) => {
  const { order, payments } = await fixture(t);
  const created = payments.beginCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: order.revision, attemptId: 'attempt-1', idempotencyKey: 'checkout:order:r1' });
  assert.equal(created.attempt.status, 'creating');
  assert.equal(created.attempt.amountCents, 2500);
  assert.equal(created.order.status, 'checkout_pending');
  const open = payments.markOpen({ attemptId: 'attempt-1', sessionId: 'cs_test_1', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  assert.equal(open.status, 'open');
  assert.equal(payments.findForOrder(order.id, 'buyer').providerSessionId, 'cs_test_1');
});

test('webhook processing binds payment to the exact attempt and is idempotent by event id', async (t) => {
  const { order, payments } = await fixture(t);
  payments.beginCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1, attemptId: 'attempt-1', idempotencyKey: 'checkout:order:r1' });
  payments.markOpen({ attemptId: 'attempt-1', sessionId: 'cs_test_1', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  const event = {
    id: 'evt_paid_1', type: 'checkout.session.completed',
    session: { id: 'cs_test_1', mode: 'payment', payment_status: 'paid', amount_total: 2500, currency: 'usd', metadata: { order_id: order.id, order_revision: '1', attempt_id: 'attempt-1' } },
  };
  assert.deepEqual(payments.processCheckoutEvent(event), { accepted: true, duplicate: false, status: 'paid' });
  assert.deepEqual(payments.processCheckoutEvent(event), { accepted: true, duplicate: true, status: 'paid' });
  assert.equal(payments.findForOrder(order.id, 'buyer').status, 'paid');
  assert.equal(payments.getOrderStatus(order.id, 'buyer'), 'paid');
});

test('webhook amount or order mismatches are recorded but never mark an order paid', async (t) => {
  const { order, payments } = await fixture(t);
  payments.beginCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1, attemptId: 'attempt-1', idempotencyKey: 'checkout:order:r1' });
  payments.markOpen({ attemptId: 'attempt-1', sessionId: 'cs_test_1', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  const outcome = payments.processCheckoutEvent({
    id: 'evt_mismatch', type: 'checkout.session.completed',
    session: { id: 'cs_test_1', mode: 'payment', payment_status: 'paid', amount_total: 1, currency: 'usd', metadata: { order_id: order.id, order_revision: '1', attempt_id: 'attempt-1' } },
  });
  assert.deepEqual(outcome, { accepted: false, duplicate: false, reason: 'amount_mismatch' });
  assert.equal(payments.getOrderStatus(order.id, 'buyer'), 'checkout_pending');
});

test('each checkout identity and payment field must match before a completion event can change state', async (t) => {
  const mismatches = [
    ['session_mismatch', (session) => { session.id = 'cs_test_other'; }],
    ['order_mismatch', (session) => { session.metadata.order_id = 'another-order'; }],
    ['revision_mismatch', (session) => { session.metadata.order_revision = '2'; }],
    ['amount_mismatch', (session) => { session.amount_total = 2499; }],
    ['currency_mismatch', (session) => { session.currency = 'cad'; }],
    ['mode_mismatch', (session) => { session.mode = 'subscription'; }],
    ['payment_not_complete', (session) => { session.payment_status = 'unpaid'; }],
  ];
  for (const [reason, change] of mismatches) {
    const { order, payments } = await fixture(t);
    payments.beginCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1, attemptId: 'attempt-1', idempotencyKey: `checkout:${reason}` });
    payments.markOpen({ attemptId: 'attempt-1', sessionId: 'cs_test_1', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const session = { id: 'cs_test_1', mode: 'payment', payment_status: 'paid', amount_total: 2500, currency: 'usd', metadata: { order_id: order.id, order_revision: '1', attempt_id: 'attempt-1' } };
    change(session);
    const outcome = payments.processCheckoutEvent({ id: `evt_${reason}`, type: 'checkout.session.completed', session });
    assert.deepEqual(outcome, { accepted: false, duplicate: false, reason });
    assert.equal(payments.getOrderStatus(order.id, 'buyer'), 'checkout_pending');
  }
});

test('expired checkout event releases a pending order and replay reports the actual terminal status', async (t) => {
  const { order, payments } = await fixture(t);
  payments.beginCheckout({ userId: 'buyer', orderId: order.id, expectedRevision: 1, attemptId: 'attempt-1', idempotencyKey: 'checkout:expired' });
  payments.markOpen({ attemptId: 'attempt-1', sessionId: 'cs_test_1', checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  const event = { id: 'evt_expired', type: 'checkout.session.expired', session: { id: 'cs_test_1', mode: 'payment', payment_status: 'unpaid', amount_total: 2500, currency: 'usd', metadata: { order_id: order.id, order_revision: '1', attempt_id: 'attempt-1' } } };
  assert.deepEqual(payments.processCheckoutEvent(event), { accepted: true, duplicate: false, status: 'expired' });
  assert.deepEqual(payments.processCheckoutEvent(event), { accepted: true, duplicate: true, status: 'expired' });
  assert.equal(payments.getOrderStatus(order.id, 'buyer'), 'ready');
});
