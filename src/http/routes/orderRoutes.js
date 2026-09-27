import { assertCsrf, assertSameOrigin, authenticateRequest } from '../security.js';
import { readJsonBody } from '../body.js';
import { sendError, sendJson } from '../responses.js';

export function createOrderRoutes({ orders, authService, cookieName = 'senta_session' }) {
  return async function handleOrderRoute(request, response, url) {
    const match = url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})$/i);
    if (!match || !['GET', 'PATCH', 'DELETE'].includes(request.method)) return false;
    try {
      const user = authenticateRequest(request, authService, cookieName);
      if (!user) throw Object.assign(new Error('Sign in is required.'), { code: 'unauthenticated' });
      const orderId = match[1];
      if (request.method === 'GET') {
        const order = orders.findOwned(orderId, user.id);
        if (!order) throw Object.assign(new Error('Order was not found.'), { code: 'not_found' });
        sendJson(response, 200, order, { 'cache-control': 'no-store' });
        return true;
      }
      const expected = `${request.socket?.encrypted ? 'https' : 'http'}://${request.headers.host}`;
      assertSameOrigin(request, expected);
      assertCsrf(request, user);
      const body = request.method === 'DELETE' ? {} : await readJsonBody(request);
      const order = request.method === 'DELETE'
        ? orders.cancel({ userId: user.id, orderId, expectedRevision: body.expectedRevision })
        : orders.edit({ userId: user.id, orderId, expectedRevision: body.expectedRevision, quantity: body.quantity, modifierIds: body.modifierIds });
      sendJson(response, 200, order, { 'cache-control': 'no-store' });
    } catch (error) {
      sendError(response, error);
    }
    return true;
  };
}
