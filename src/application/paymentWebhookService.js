export function createPaymentWebhookService({ verifier, payments }) {
  if (!verifier || !payments) throw new TypeError('Webhook verifier and payment repository are required');
  return Object.freeze({
    receive(rawBody, signatureHeader) {
      verifier.verify(rawBody, signatureHeader);
      let event;
      try { event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody); }
      catch { throw codedError('invalid_webhook', 'Stripe webhook body is invalid JSON.'); }
      if (!event || typeof event.id !== 'string' || !event.id.startsWith('evt_') || typeof event.type !== 'string') {
        throw codedError('invalid_webhook', 'Stripe webhook event is malformed.');
      }
      if (!['checkout.session.completed', 'checkout.session.expired'].includes(event.type)) {
        return { accepted: true, duplicate: false, ignored: true };
      }
      const session = event.data?.object;
      if (!session || typeof session !== 'object') {
        return { accepted: true, duplicate: false, ignored: true };
      }
      return payments.processCheckoutEvent({ id: event.id, type: event.type, session });
    },
  });
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
