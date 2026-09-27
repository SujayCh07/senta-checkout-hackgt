import { assertCsrf, assertSameOrigin, authenticateRequest } from '../security.js';
import { readJsonBody } from '../body.js';
import { sendError, sendJson } from '../responses.js';

const ORDER_ROUTE = /^\/api\/orders\/([a-f0-9-]{36})(?:\/(checkout|items)(?:\/([a-f0-9-]{36}))?)?$/i;

export function createOrderRoutes({ orders, authService, checkoutService = null, cookieName = 'senta_session', expectedOrigin = null }) {
  return async function handleOrderRoute(request, response, url) {
    const match = url.pathname.match(ORDER_ROUTE);
    if (!match || !['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) return false;
    const orderId = match[1];
    const resource = match[2] ?? 'order';
    const lineItemId = match[3] ?? null;
    const allowed = resource === 'checkout'
      ? ['GET', 'POST']
      : resource === 'items'
        ? lineItemId ? ['PATCH', 'DELETE'] : ['POST']
        : ['GET', 'PATCH', 'DELETE'];
    if (!allowed.includes(request.method)) {
      sendJson(response, 405, { error: 'Method not allowed.', code: 'method_not_allowed' }, { allow: allowed.join(', ') });
      return true;
    }

    try {
      const user = authenticateRequest(request, authService, cookieName);
      if (!user) throw Object.assign(new Error('Sign in is required.'), { code: 'unauthenticated' });
      if (request.method === 'GET') {
        if (resource === 'checkout') {
          if (!checkoutService) throw Object.assign(new Error('Stripe test-mode checkout is not configured.'), { code: 'payment_unavailable' });
          const attempt = checkoutService.getCheckout({ userId: user.id, orderId });
          if (!attempt) throw Object.assign(new Error('Checkout was not found.'), { code: 'not_found' });
          sendJson(response, 200, publicCheckout(attempt), { 'cache-control': 'no-store' });
        } else {
          sendJson(response, 200, orders.get({ userId: user.id, orderId }), { 'cache-control': 'no-store' });
        }
        return true;
      }

      const origin = expectedOrigin || `${request.socket?.encrypted ? 'https' : 'http'}://${request.headers.host}`;
      assertSameOrigin(request, origin);
      assertCsrf(request, user);
      const body = await readJsonBody(request);
      if (resource === 'checkout') {
        if (!checkoutService) throw Object.assign(new Error('Stripe test-mode checkout is not configured.'), { code: 'payment_unavailable' });
        const checkout = await checkoutService.createCheckout({ userId: user.id, orderId, expectedRevision: body.expectedRevision });
        sendJson(response, checkout.status === 'unknown_state' ? 202 : 200, checkout, { 'cache-control': 'no-store' });
      } else if (resource === 'items' && request.method === 'POST') {
        sendJson(response, 200, orders.addMenuItem({ userId: user.id, orderId, itemId: body.itemId, quantity: body.quantity, modifierIds: body.modifierIds, expectedRevision: body.expectedRevision }), { 'cache-control': 'no-store' });
      } else if (resource === 'items' && request.method === 'PATCH') {
        sendJson(response, 200, orders.editLine({ userId: user.id, orderId, lineItemId, quantity: body.quantity, modifierIds: body.modifierIds, expectedRevision: body.expectedRevision }), { 'cache-control': 'no-store' });
      } else if (resource === 'items' && request.method === 'DELETE') {
        sendJson(response, 200, orders.removeLine({ userId: user.id, orderId, lineItemId, expectedRevision: body.expectedRevision }), { 'cache-control': 'no-store' });
      } else if (request.method === 'DELETE') {
        sendJson(response, 200, orders.cancel({ userId: user.id, orderId, expectedRevision: body.expectedRevision }), { 'cache-control': 'no-store' });
      } else {
        sendJson(response, 200, orders.editLine({ userId: user.id, orderId, quantity: body.quantity, modifierIds: body.modifierIds, expectedRevision: body.expectedRevision }), { 'cache-control': 'no-store' });
      }
    } catch (error) {
      sendError(response, error);
    }
    return true;
  };
}

function publicCheckout(attempt) {
  return {
    id: attempt.id,
    orderId: attempt.orderId,
    status: attempt.status,
    sessionId: attempt.providerSessionId,
    checkoutUrl: attempt.checkoutUrl,
    amountCents: attempt.amountCents,
    currency: attempt.currency,
  };
}
