import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createStripeWebhookVerifier } from '../src/providers/stripeWebhookVerifier.js';

function signature(secret, timestamp, body) {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('Stripe webhook verifier authenticates the exact raw request body and rejects stale timestamps', () => {
  const secret = 'whsec_test_only';
  let now = 1_800_000_000;
  const verifier = createStripeWebhookVerifier({ secret, now: () => now, toleranceSeconds: 300 });
  const rawBody = '{"id":"evt_123","type":"checkout.session.completed"}';
  assert.equal(verifier.verify(rawBody, signature(secret, now, rawBody)), true);
  assert.throws(() => verifier.verify(`${rawBody} `, signature(secret, now, rawBody)), { code: 'invalid_webhook_signature' });
  now += 301;
  assert.throws(() => verifier.verify(rawBody, signature(secret, 1_800_000_000, rawBody)), { code: 'invalid_webhook_signature' });
});

test('Stripe webhook verifier accepts any matching v1 signature and rejects malformed headers', () => {
  const secret = 'whsec_test_only';
  const rawBody = '{}';
  const timestamp = 1000;
  const valid = signature(secret, timestamp, rawBody).split(',')[1];
  const verifier = createStripeWebhookVerifier({ secret, now: () => timestamp });
  assert.equal(verifier.verify(rawBody, `t=${timestamp},v1=${'0'.repeat(64)},${valid}`), true);
  assert.throws(() => verifier.verify(rawBody, 'not-a-signature'), { code: 'invalid_webhook_signature' });
});
