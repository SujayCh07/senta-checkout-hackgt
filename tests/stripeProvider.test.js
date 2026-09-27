import assert from 'node:assert/strict';
import test from 'node:test';
import { createStripeCheckoutProvider } from '../src/providers/stripeCheckoutProvider.js';

const order = {
  id: 'order-123', userId: 'user-456', revision: 3, status: 'ready',
  item: { name: 'Northstar Grain Bowl' }, quantity: 2,
  modifiers: [{ id: 'grain-bowl-chicken', name: 'Add grilled chicken', priceDeltaCents: 300 }],
  unitPriceCents: 1550, totalCents: 3100, currency: 'USD',
};

test('Stripe Checkout sends server-priced cents, order metadata, test idempotency, and safe return URLs', async () => {
  let captured;
  const provider = createStripeCheckoutProvider({
    secretKey: 'sk_test_unit',
    successUrl: 'http://localhost:3002/checkout/success',
    cancelUrl: 'http://localhost:3002/checkout/cancel',
    fetchImpl: async (url, options) => {
      captured = { url, options, fields: new URLSearchParams(options.body) };
      return new Response(JSON.stringify({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }), { status: 200 });
    },
  });
  const session = await provider.createCheckout({ order, attemptId: 'attempt-789', idempotencyKey: 'checkout:order-123:r3' });
  assert.equal(captured.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(captured.options.headers.Authorization, 'Bearer sk_test_unit');
  assert.equal(captured.options.headers['Idempotency-Key'], 'checkout:order-123:r3');
  assert.equal(captured.fields.get('line_items[0][price_data][unit_amount]'), '1550');
  assert.equal(captured.fields.get('line_items[0][quantity]'), '2');
  assert.equal(captured.fields.get('metadata[order_id]'), 'order-123');
  assert.equal(captured.fields.get('metadata[order_revision]'), '3');
  assert.equal(captured.fields.get('metadata[attempt_id]'), 'attempt-789');
  assert.equal(captured.fields.get('success_url'), `http://localhost:3002/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`);
  assert.deepEqual(session, { id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' });
});

test('Stripe provider refuses live keys and marks ambiguous network outcomes explicitly', async () => {
  assert.throws(() => createStripeCheckoutProvider({ secretKey: 'sk_live_unsafe' }), { code: 'payment_unavailable' });
  const provider = createStripeCheckoutProvider({ secretKey: 'sk_test_unit', fetchImpl: async () => { throw Object.assign(new Error('timeout'), { name: 'AbortError' }); } });
  await assert.rejects(provider.createCheckout({ order, attemptId: 'attempt-789', idempotencyKey: 'checkout:order-123:r3' }), { code: 'ambiguous_checkout' });
});

test('Stripe Checkout receives each cart line with its own saved quantity and unit price', async () => {
  let fields;
  const provider = createStripeCheckoutProvider({
    secretKey: 'sk_test_unit',
    fetchImpl: async (_url, options) => {
      fields = new URLSearchParams(options.body);
      return new Response(JSON.stringify({ id: 'cs_test_cart', url: 'https://checkout.stripe.com/c/pay/cs_test_cart' }), { status: 200 });
    },
  });
  const twoLineOrder = {
    ...order,
    items: [
      { item: { name: 'Northstar Grain Bowl' }, quantity: 2, unitPriceCents: 1250, modifiers: [] },
      { item: { name: 'Crispy Chickpea Bowl' }, quantity: 1, unitPriceCents: 1100, modifiers: [] },
    ],
    totalCents: 3600,
  };
  await provider.createCheckout({ order: twoLineOrder, attemptId: 'attempt-cart', idempotencyKey: 'checkout:cart:r3' });
  assert.equal(fields.get('line_items[0][price_data][unit_amount]'), '1250');
  assert.equal(fields.get('line_items[0][quantity]'), '2');
  assert.equal(fields.get('line_items[1][price_data][unit_amount]'), '1100');
  assert.equal(fields.get('line_items[1][quantity]'), '1');
});

test('Stripe provider separates known request failures from ambiguous server failures', async () => {
  const rejected = createStripeCheckoutProvider({ secretKey: 'sk_test_unit', fetchImpl: async () => new Response('{"error":"private provider details"}', { status: 400 }) });
  await assert.rejects(rejected.createCheckout({ order, attemptId: 'attempt-1', idempotencyKey: 'checkout:known' }), { code: 'stripe_rejected' });
  const unavailable = createStripeCheckoutProvider({ secretKey: 'sk_test_unit', fetchImpl: async () => new Response('{}', { status: 503 }) });
  await assert.rejects(unavailable.createCheckout({ order, attemptId: 'attempt-1', idempotencyKey: 'checkout:unknown' }), { code: 'ambiguous_checkout' });
  const invalidSession = createStripeCheckoutProvider({ secretKey: 'sk_test_unit', fetchImpl: async () => new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://evil.example.test/pay' }), { status: 200 }) });
  await assert.rejects(invalidSession.createCheckout({ order, attemptId: 'attempt-1', idempotencyKey: 'checkout:malformed' }), { code: 'ambiguous_checkout' });
});
