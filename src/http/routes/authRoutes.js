import { authenticateRequest, assertCsrf, assertSameOrigin, readSessionToken, sessionCookie } from '../security.js';
import { readJsonBody } from '../body.js';
import { sendError, sendJson } from '../responses.js';

export function createAuthRoutes({ authService, cookieName = 'senta_session', secureCookies = false }) {
  return async function handleAuthRoute(request, response, url) {
    const route = `${request.method} ${url.pathname}`;
    if (!['GET /api/auth/me', 'POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/logout'].includes(route)) {
      return false;
    }
    if (!authService) {
      sendJson(response, 503, { error: 'Account service is not configured.', code: 'auth_unavailable' });
      return true;
    }

    try {
      if (request.method === 'POST') assertRequestOrigin(request);
      if (route === 'GET /api/auth/me') {
        const account = authenticateRequest(request, authService, cookieName);
        sendJson(response, account ? 200 : 401, account ? { user: publicUser(account), csrfToken: account.csrfToken } : { error: 'Sign in is required.', code: 'unauthenticated' });
        return true;
      }

      if (route === 'POST /api/auth/register' || route === 'POST /api/auth/login') {
        const body = await readJsonBody(request);
        const result = route.endsWith('/register')
          ? authService.register({ email: body.email, password: body.password })
          : authService.login({ email: body.email, password: body.password });
        sendJson(response, route.endsWith('/register') ? 201 : 200, {
          user: result.user,
          csrfToken: result.session.csrfToken,
        }, {
          'set-cookie': sessionCookie(result.session.rawToken, { name: cookieName, secure: secureCookies }),
          'cache-control': 'no-store',
        });
        return true;
      }

      const token = readSessionToken(request, cookieName);
      const account = authenticateRequest(request, authService, cookieName);
      if (!account) throw Object.assign(new Error('Sign in is required.'), { code: 'unauthenticated' });
      assertCsrf(request, account);
      authService.logout(token);
      sendJson(response, 200, { ok: true }, {
        'set-cookie': sessionCookie('', { name: cookieName, secure: secureCookies, clear: true }),
        'cache-control': 'no-store',
      });
    } catch (error) {
      sendError(response, error);
    }
    return true;
  };
}

function assertRequestOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) throw Object.assign(new Error('Request origin is not allowed.'), { code: 'origin_rejected' });
  const expected = `${request.socket?.encrypted ? 'https' : 'http'}://${request.headers.host}`;
  assertSameOrigin(request, expected);
}

function publicUser(account) {
  return { id: account.id, email: account.email, createdAt: account.createdAt };
}
