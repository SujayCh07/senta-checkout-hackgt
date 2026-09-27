import { assertCsrf, assertSameOrigin, authenticateRequest } from '../security.js';
import { readJsonBody } from '../body.js';
import { sendError, sendJson } from '../responses.js';

const IDS = '[a-f0-9-]{36}';

export function createConversationRoutes({ conversations, authService, cookieName = 'senta_session' }) {
  return async function handleConversationRoute(request, response, url) {
    const create = request.method === 'POST' && url.pathname === '/api/conversations';
    const match = url.pathname.match(new RegExp(`^/api/conversations/(${IDS})(?:/messages)?$`, 'i'));
    const messageRoute = match && url.pathname.endsWith('/messages');
    const readRoute = request.method === 'GET' && match && !messageRoute;
    if (!create && !messageRoute && !readRoute) return false;

    try {
      const user = authenticateRequest(request, authService, cookieName);
      if (!user) throw Object.assign(new Error('Sign in is required.'), { code: 'unauthenticated' });
      if (create || messageRoute) {
        assertRequestOrigin(request);
        assertCsrf(request, user);
      }
      if (create) {
        const created = conversations.createConversation(user.id);
        sendJson(response, 201, created, { 'cache-control': 'no-store' });
        return true;
      }
      if (readRoute) {
        sendJson(response, 200, conversations.getConversation(user.id, match[1]), { 'cache-control': 'no-store' });
        return true;
      }
      const body = await readJsonBody(request);
      sendJson(response, 200, conversations.sendMessage({ userId: user.id, conversationId: match[1], text: body.text }), { 'cache-control': 'no-store' });
    } catch (error) {
      sendError(response, error);
    }
    return true;
  };
}

function assertRequestOrigin(request) {
  const origin = request.headers.origin;
  const expected = `${request.socket?.encrypted ? 'https' : 'http'}://${request.headers.host}`;
  assertSameOrigin(request, expected);
  if (!origin) throw Object.assign(new Error('Request origin is not allowed.'), { code: 'origin_rejected' });
}
