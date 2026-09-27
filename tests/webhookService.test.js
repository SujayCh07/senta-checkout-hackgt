import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createPaymentWebhookService } from '../src/application/paymentWebhookService.js';
import { createStripeWebhookVerifier } from '../src/providers/stripeWebhookVerifier.js';

function sign(secret, timestamp, body) {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('webhook service verifies the raw body before parsing or recording provider events', () => {
  const secret = 'whsec_service_test';
  const now = 1_800_000_000;
  const verifier = createStripeWebhookVerifier({ secret, now: () => now });
  const events = [];
  const service = createPaymentWebhookService({ verifier, payments: { processCheckoutEvent: (event) => { events.push(event); return { accepted: true }; } } });
  const body = JSON.stringify({ id: 'evt_123', type: 'checkout.session.completed', data: { object: { id: 'cs_test_123' } } });
  assert.throws(() => service.receive(body, sign(secret, now, `${body} `)), { code: 'invalid_webhook_signature' });
  assert.equal(events.length, 0);
  assert.deepEqual(service.receive(body, sign(secret, now, body)), { accepted: true });
  assert.equal(events[0].id, 'evt_123');
  assert.equal(events[0].session.id, 'cs_test_123');
});

test('webhook service rejects signed malformed events and acknowledges unrelated valid events', () => {
  const secret = 'whsec_service_test';
  const now = 1_800_000_000;
  const verifier = createStripeWebhookVerifier({ secret, now: () => now });
  const service = createPaymentWebhookService({ verifier, payments: { processCheckoutEvent: () => { throw new Error('not expected'); } } });
  const malformed = '{';
  assert.throws(() => service.receive(malformed, sign(secret, now, malformed)), { code: 'invalid_webhook' });
  const unrelated = JSON.stringify({ id: 'evt_other', type: 'customer.updated', data: { object: { id: 'cus_123' } } });
  assert.deepEqual(service.receive(unrelated, sign(secret, now, unrelated)), { accepted: true, duplicate: false, ignored: true });
  const noObject = JSON.stringify({ id: 'evt_no_object', type: 'checkout.session.completed', data: {} });
  assert.deepEqual(service.receive(noObject, sign(secret, now, noObject)), { accepted: true, duplicate: false, ignored: true });
});
