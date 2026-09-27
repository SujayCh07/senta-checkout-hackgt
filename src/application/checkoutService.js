import { randomUUID } from 'node:crypto';
import { calculateCartTotals } from '../domain/cart.js';

export function createCheckoutService({ orders, payments, provider, catalog }) {
  if (!orders || !payments || !provider || !catalog) throw new TypeError('Order, payment, catalog, and provider services are required');

  return Object.freeze({
    async createCheckout({ userId, orderId, expectedRevision }) {
      const order = orders.findOwned(orderId, userId);
      if (!order) throw codedError('not_found', 'Order was not found.');
      if (order.revision !== expectedRevision) throw codedError('revision_conflict', 'The order changed. Refresh before checkout.');
      const pricedLines = order.items.map((line) => {
        const item = catalog.findItem(line.menuItemId);
        if (!item) throw codedError('item_unavailable', `${line.item.name} is no longer available.`);
        return { item, quantity: line.quantity, modifierIds: line.modifiers.map((modifier) => modifier.id) };
      });
      const currentTotals = calculateCartTotals(pricedLines);
      const linePriceChanged = currentTotals.lineItems.some((line, index) => {
        const snapshot = order.items[index];
        return !snapshot || snapshot.menuItemId !== line.itemId || snapshot.item.name !== line.name
          || snapshot.unitPriceCents !== line.unitPriceCents || snapshot.lineTotalCents !== line.totalCents;
      });
      if (linePriceChanged || currentTotals.totalCents !== order.totalCents) {
        throw codedError('price_changed', 'Menu pricing changed. Review the updated cart before checkout.');
      }
      let existing = payments.findForOrder(orderId, userId);
      if (existing?.status === 'open') return checkoutResponse(existing);
      if (existing && !['creating', 'payment_unknown'].includes(existing.status) && order.status !== 'ready') {
        throw codedError('attempt_conflict', 'This order already has a completed or closed checkout attempt.');
      }

      const activeAttempt = existing && ['creating', 'payment_unknown'].includes(existing.status) ? existing : null;
      const attemptId = activeAttempt?.id ?? randomUUID();
      const idempotencyKey = activeAttempt?.idempotencyKey ?? `checkout:${order.id}:r${order.revision}:${attemptId}`;
      const initialized = payments.beginCheckout({
        userId,
        orderId,
        expectedRevision,
        attemptId,
        idempotencyKey,
      });
      existing = initialized.attempt;
      const stripeOrder = {
        id: order.id,
        revision: order.revision,
        item: order.item,
        modifiers: order.modifiers,
        quantity: order.quantity,
        unitPriceCents: order.unitPriceCents,
        items: order.items.map((line) => ({
          item: line.item,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          modifiers: line.modifiers,
        })),
        totalCents: order.totalCents,
        currency: order.currency,
      };

      let session;
      try {
        session = await provider.createCheckout({ order: stripeOrder, attemptId: existing.id, idempotencyKey: existing.idempotencyKey });
      } catch (error) {
        if (error.code === 'ambiguous_checkout') {
          payments.markUnknown(existing.id);
          return { status: 'unknown_state', orderId, message: 'Payment provider status is not confirmed yet. Retry checkout to reconcile safely.' };
        }
        payments.markFailed(existing.id);
        throw error;
      }
      const attempt = payments.markOpen({ attemptId: existing.id, sessionId: session.id, checkoutUrl: session.url });
      return checkoutResponse(attempt);
    },

    getCheckout({ userId, orderId }) {
      const order = orders.findOwned(orderId, userId);
      if (!order) throw codedError('not_found', 'Order was not found.');
      return payments.findForOrder(orderId, userId);
    },
  });
}

function checkoutResponse(attempt) {
  return {
    status: 'open',
    orderId: attempt.orderId,
    attemptId: attempt.id,
    sessionId: attempt.providerSessionId,
    url: attempt.checkoutUrl,
  };
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
