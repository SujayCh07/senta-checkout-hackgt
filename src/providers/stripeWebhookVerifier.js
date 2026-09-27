import { createHmac, timingSafeEqual } from 'node:crypto';

export function createStripeWebhookVerifier({ secret, now = () => Math.floor(Date.now() / 1000), toleranceSeconds = 300 } = {}) {
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) {
    throw codedError('payment_unavailable', 'A Stripe webhook signing secret is required.');
  }
  if (!Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 1) throw new TypeError('Webhook tolerance must be a positive integer');

  return Object.freeze({
    verify(rawBody, header) {
      if (!(typeof rawBody === 'string' || Buffer.isBuffer(rawBody)) || typeof header !== 'string') {
        throw codedError('invalid_webhook_signature', 'Stripe webhook signature is invalid.');
      }
      const parsed = parseSignatureHeader(header);
      const current = now();
      if (Math.abs(current - parsed.timestamp) > toleranceSeconds) {
        throw codedError('invalid_webhook_signature', 'Stripe webhook signature is outside the allowed time window.');
      }
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
      const signed = Buffer.concat([Buffer.from(`${parsed.timestamp}.`, 'utf8'), body]);
      const expected = createHmac('sha256', secret).update(signed).digest();
      const matches = parsed.signatures.some((signature) => {
        if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
        const candidate = Buffer.from(signature, 'hex');
        return candidate.length === expected.length && timingSafeEqual(candidate, expected);
      });
      if (!matches) throw codedError('invalid_webhook_signature', 'Stripe webhook signature is invalid.');
      return true;
    },
  });
}

function parseSignatureHeader(header) {
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') {
      if (timestamp !== null || !/^\d+$/.test(value)) throw codedError('invalid_webhook_signature', 'Stripe webhook signature is malformed.');
      timestamp = Number(value);
    }
    if (key === 'v1') signatures.push(value);
  }
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) {
    throw codedError('invalid_webhook_signature', 'Stripe webhook signature is malformed.');
  }
  return { timestamp, signatures };
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
