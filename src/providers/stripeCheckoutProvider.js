const STRIPE_ENDPOINT = 'https://api.stripe.com/v1/checkout/sessions';
const STRIPE_CHECKOUT_HOST = 'checkout.stripe.com';

export function createStripeCheckoutProvider({
  secretKey,
  successUrl = 'http://localhost:3002/checkout/success',
  cancelUrl = 'http://localhost:3002/checkout/cancel',
  fetchImpl = fetch,
  timeoutMs = 12_000,
} = {}) {
  if (typeof secretKey !== 'string' || !secretKey.startsWith('sk_test_')) {
    throw codedError('payment_unavailable', 'Stripe test-mode credentials are required.');
  }
  validateReturnUrl(successUrl);
  validateReturnUrl(cancelUrl);
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  return Object.freeze({
    async createCheckout({ order, attemptId, idempotencyKey }) {
      validateOrder(order);
      const body = new URLSearchParams();
      body.set('mode', 'payment');
      body.set('payment_method_types[0]', 'card');
      const lines = checkoutLines(order);
      lines.forEach((line, index) => {
        body.set(`line_items[${index}][price_data][currency]`, order.currency.toLowerCase());
        body.set(`line_items[${index}][price_data][unit_amount]`, String(line.unitPriceCents));
        body.set(`line_items[${index}][price_data][product_data][name]`, displayLineItemName(line));
        body.set(`line_items[${index}][quantity]`, String(line.quantity));
      });
      body.set('client_reference_id', order.id);
      body.set('metadata[order_id]', order.id);
      body.set('metadata[order_revision]', String(order.revision));
      body.set('metadata[attempt_id]', attemptId);
      body.set('success_url', withCheckoutPlaceholder(successUrl, order.id));
      body.set('cancel_url', withOrderReference(cancelUrl, order.id));

      let response;
      try {
        response = await fetchImpl(STRIPE_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': idempotencyKey,
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw codedError('ambiguous_checkout', 'Stripe may have created a checkout session. Retry only with the same idempotency key.', error);
      }

      let payload;
      try { payload = await response.json(); } catch {
        throw codedError(response.status >= 500 ? 'ambiguous_checkout' : 'stripe_rejected', 'Stripe returned an unreadable checkout response.');
      }
      if (!response.ok) {
        if (response.status >= 500) throw codedError('ambiguous_checkout', 'Stripe checkout status is unknown. Reconcile using the same idempotency key.');
        throw codedError('stripe_rejected', 'Stripe rejected the checkout request.');
      }
      const session = { id: payload.id, url: payload.url };
      if (typeof session.id !== 'string' || !session.id.startsWith('cs_test_') || !isStripeCheckoutUrl(session.url)) {
        throw codedError('ambiguous_checkout', 'Stripe returned an unexpected checkout session response.');
      }
      return session;
    },
  });
}

function validateOrder(order) {
  const lines = checkoutLines(order ?? {});
  const validLines = lines.length > 0 && lines.every((line) => Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 20
    && Number.isSafeInteger(line.unitPriceCents) && line.unitPriceCents > 0 && line.item?.name);
  const total = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  if (!order || typeof order.id !== 'string' || !Number.isInteger(order.revision) || order.revision < 1
    || !validLines || total !== order.totalCents || !Number.isSafeInteger(total)
    || !/^[A-Z]{3}$/.test(order.currency)) {
    throw codedError('invalid_order', 'Order totals are not valid for checkout.');
  }
}

function checkoutLines(order) {
  if (Array.isArray(order.items)) return order.items;
  return order.item ? [{ item: order.item, quantity: order.quantity, unitPriceCents: order.unitPriceCents, modifiers: order.modifiers }] : [];
}

function displayLineItemName(line) {
  const modifiers = Array.isArray(line.modifiers) ? line.modifiers.map((modifier) => modifier.name).filter(Boolean) : [];
  return modifiers.length ? `${line.item.name} (${modifiers.join(', ')})` : line.item.name;
}

function validateReturnUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw codedError('payment_unavailable', 'Stripe return URLs must be valid URLs.'); }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw codedError('payment_unavailable', 'Stripe return URLs must use HTTPS outside local development.');
  }
  if (url.username || url.password) throw codedError('payment_unavailable', 'Stripe return URLs cannot contain credentials.');
}

function withCheckoutPlaceholder(value, orderId) {
  const url = new URL(value);
  url.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  url.searchParams.set('order_id', orderId);
  return url.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
}

function withOrderReference(value, orderId) {
  const url = new URL(value);
  url.searchParams.set('order_id', orderId);
  return url.toString();
}

function isStripeCheckoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === STRIPE_CHECKOUT_HOST;
  } catch { return false; }
}

function codedError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}
