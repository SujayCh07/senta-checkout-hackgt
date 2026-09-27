import { withTransaction } from '../infrastructure/database.js';

export function createPaymentRepository(db, { now = Date.now } = {}) {
  const orderForOwner = db.prepare(`
    SELECT id, user_id AS userId, status, currency, subtotal_cents AS subtotalCents,
           total_cents AS totalCents, revision, updated_at AS updatedAt
    FROM orders WHERE id = ? AND user_id = ?
  `);
  const attemptForOrderRevision = db.prepare(`
    SELECT id, order_id AS orderId, order_revision AS orderRevision, status,
           provider_session_id AS providerSessionId, checkout_url AS checkoutUrl,
           idempotency_key AS idempotencyKey, amount_cents AS amountCents,
           currency, created_at AS createdAt, updated_at AS updatedAt
    FROM checkout_attempts WHERE order_id = ? AND order_revision = ? ORDER BY created_at DESC LIMIT 1
  `);
  const insertAttempt = db.prepare(`
    INSERT INTO checkout_attempts
      (id, order_id, order_revision, status, idempotency_key, amount_cents, currency, created_at, updated_at)
    VALUES (?, ?, ?, 'creating', ?, ?, ?, ?, ?)
  `);
  const setOrderPending = db.prepare(`
    UPDATE orders SET status = 'checkout_pending', updated_at = ?
    WHERE id = ? AND user_id = ? AND revision = ? AND status = 'ready'
  `);
  const changeAttempt = db.prepare(`
    UPDATE checkout_attempts SET status = ?, provider_session_id = COALESCE(?, provider_session_id),
      checkout_url = COALESCE(?, checkout_url), updated_at = ?
    WHERE id = ? AND status IN ('creating', 'payment_unknown')
  `);
  const byAttemptId = db.prepare(`
    SELECT id, order_id AS orderId, order_revision AS orderRevision, status,
           provider_session_id AS providerSessionId, checkout_url AS checkoutUrl,
           idempotency_key AS idempotencyKey, amount_cents AS amountCents, currency,
           created_at AS createdAt, updated_at AS updatedAt
    FROM checkout_attempts WHERE id = ?
  `);
  const ownerAttempt = db.prepare(`
    SELECT ca.id, ca.order_id AS orderId, ca.order_revision AS orderRevision, ca.status,
           ca.provider_session_id AS providerSessionId, ca.checkout_url AS checkoutUrl,
           ca.idempotency_key AS idempotencyKey, ca.amount_cents AS amountCents, ca.currency,
           ca.created_at AS createdAt, ca.updated_at AS updatedAt
    FROM checkout_attempts ca JOIN orders o ON o.id = ca.order_id
    WHERE ca.order_id = ? AND o.user_id = ? ORDER BY ca.created_at DESC LIMIT 1
  `);
  const orderStatusByOwner = db.prepare('SELECT status FROM orders WHERE id = ? AND user_id = ?');
  const restoreReady = db.prepare(`UPDATE orders SET status = 'ready', updated_at = ? WHERE id = ? AND status IN ('checkout_pending', 'payment_unknown')`);
  const insertEvent = db.prepare(`
    INSERT INTO provider_events (id, provider, event_type, checkout_attempt_id, received_at)
    VALUES (?, 'stripe', ?, ?, ?)
  `);
  const existingEvent = db.prepare('SELECT checkout_attempt_id AS attemptId, processed_at AS processedAt, processing_error AS processingError FROM provider_events WHERE id = ?');
  const updateEvent = db.prepare(`
    UPDATE provider_events SET checkout_attempt_id = ?, processed_at = ?, processing_error = ? WHERE id = ?
  `);
  const paidOrder = db.prepare(`
    UPDATE orders SET status = 'paid', revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND status IN ('checkout_pending', 'payment_unknown')
  `);
  const paidAttempt = db.prepare(`UPDATE checkout_attempts SET status = 'paid', updated_at = ? WHERE id = ? AND status IN ('open', 'payment_unknown')`);
  const expireAttempt = db.prepare(`UPDATE checkout_attempts SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('open', 'payment_unknown')`);

  function findAttempt(id) { return byAttemptId.get(id) ?? null; }

  function processCheckoutEvent(event) {
    return withTransaction(db, () => {
      const duplicate = existingEvent.get(event.id);
      if (duplicate) {
        if (duplicate.processingError) return { accepted: false, duplicate: true, reason: duplicate.processingError };
        return { accepted: true, duplicate: true, status: findAttempt(duplicate.attemptId)?.status ?? 'processed' };
      }
      const attemptId = event.session?.metadata?.attempt_id || null;
      let attempt = attemptId ? findAttempt(attemptId) : null;
      insertEvent.run(event.id, event.type, attempt?.id ?? null, now());
      if (!attempt) return rejectEvent(event.id, null, 'attempt_not_found');

      const session = event.session;
      const metadata = session?.metadata ?? {};
      if (session?.id !== attempt.providerSessionId) return rejectEvent(event.id, attempt.id, 'session_mismatch');
      if (metadata.order_id !== attempt.orderId) return rejectEvent(event.id, attempt.id, 'order_mismatch');
      if (metadata.order_revision !== String(attempt.orderRevision)) return rejectEvent(event.id, attempt.id, 'revision_mismatch');
      if (Number(session.amount_total) !== attempt.amountCents) return rejectEvent(event.id, attempt.id, 'amount_mismatch');
      if (String(session.currency).toUpperCase() !== attempt.currency) return rejectEvent(event.id, attempt.id, 'currency_mismatch');
      if (session.mode !== 'payment') return rejectEvent(event.id, attempt.id, 'mode_mismatch');

      if (event.type === 'checkout.session.expired') {
        expireAttempt.run(now(), attempt.id);
        restoreReady.run(now(), attempt.orderId);
        updateEvent.run(attempt.id, now(), null, event.id);
        return { accepted: true, duplicate: false, status: 'expired' };
      }
      if (event.type !== 'checkout.session.completed' || session.payment_status !== 'paid') {
        return rejectEvent(event.id, attempt.id, 'payment_not_complete');
      }

      const order = db.prepare(`SELECT status, revision, total_cents AS totalCents, currency FROM orders WHERE id = ?`).get(attempt.orderId);
      if (!order || order.revision !== attempt.orderRevision || order.totalCents !== attempt.amountCents || order.currency !== attempt.currency) {
        return rejectEvent(event.id, attempt.id, 'order_snapshot_mismatch');
      }
      const timestamp = now();
      if (paidOrder.run(timestamp, attempt.orderId, attempt.orderRevision).changes !== 1) {
        return rejectEvent(event.id, attempt.id, 'order_not_payable');
      }
      paidAttempt.run(timestamp, attempt.id);
      updateEvent.run(attempt.id, timestamp, null, event.id);
      return { accepted: true, duplicate: false, status: 'paid' };
    });
  }

  function rejectEvent(eventId, attemptId, reason) {
    updateEvent.run(attemptId, now(), reason, eventId);
    return { accepted: false, duplicate: false, reason };
  }

  return Object.freeze({
    beginCheckout({ userId, orderId, expectedRevision, attemptId, idempotencyKey }) {
      return withTransaction(db, () => {
        const order = orderForOwner.get(orderId, userId);
        if (!order) throw codedError('not_found', 'Order was not found.');
        if (order.revision !== expectedRevision) throw codedError('revision_conflict', 'The order changed. Refresh before checkout.');
        const existing = attemptForOrderRevision.get(orderId, expectedRevision);
        if (existing && ['creating', 'open', 'payment_unknown'].includes(existing.status)) return { order, attempt: existing, created: false };
        if (order.status !== 'ready') throw codedError('order_locked', 'This order is not ready for checkout.');
        const timestamp = now();
        insertAttempt.run(attemptId, orderId, expectedRevision, idempotencyKey, order.totalCents, order.currency, timestamp, timestamp);
        if (setOrderPending.run(timestamp, orderId, userId, expectedRevision).changes !== 1) {
          throw codedError('revision_conflict', 'The order changed. Refresh before checkout.');
        }
        return { order: { ...order, status: 'checkout_pending' }, attempt: findAttempt(attemptId), created: true };
      });
    },
    markOpen({ attemptId, sessionId, checkoutUrl }) {
      const timestamp = now();
      if (changeAttempt.run('open', sessionId, checkoutUrl, timestamp, attemptId).changes !== 1) {
        throw codedError('attempt_conflict', 'Checkout attempt cannot be opened.');
      }
      return findAttempt(attemptId);
    },
    markUnknown(attemptId) {
      const timestamp = now();
      changeAttempt.run('payment_unknown', null, null, timestamp, attemptId);
      const attempt = findAttempt(attemptId);
      if (attempt) db.prepare(`UPDATE orders SET status = 'payment_unknown', updated_at = ? WHERE id = ? AND status = 'checkout_pending'`).run(timestamp, attempt.orderId);
      return attempt;
    },
    markFailed(attemptId) {
      const attempt = findAttempt(attemptId);
      if (!attempt) return null;
      withTransaction(db, () => {
        db.prepare(`UPDATE checkout_attempts SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'creating'`).run(now(), attemptId);
        restoreReady.run(now(), attempt.orderId);
      });
      return findAttempt(attemptId);
    },
    findForOrder(orderId, userId) { return ownerAttempt.get(orderId, userId) ?? null; },
    getOrderStatus(orderId, userId) { return orderStatusByOwner.get(orderId, userId)?.status ?? null; },
    processCheckoutEvent,
  });
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
