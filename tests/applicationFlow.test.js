import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createRuntime } from '../src/runtime.js';
import { createCatalogRoutes } from '../src/http/routes/catalogRoutes.js';
import { createConversationRoutes } from '../src/http/routes/conversationRoutes.js';
import { createOrderRoutes } from '../src/http/routes/orderRoutes.js';

function makeRequest({ method, path, body, cookie, csrf }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = path;
  req.headers = { host: 'localhost:3002', origin: 'http://localhost:3002' };
  if (body !== undefined) req.headers['content-type'] = 'application/json';
  if (cookie) req.headers.cookie = cookie;
  if (csrf) req.headers['x-csrf-token'] = csrf;
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function makeResponse() {
  return {
    headers: {},
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body = body; },
    json() { return this.body ? JSON.parse(this.body) : null; },
  };
}

test('application flow creates an account, builds a persistent multi-item cart, and enforces ownership and CSRF', async (t) => {
  const runtime = createRuntime({ databasePath: ':memory:' });
  t.after(() => runtime.close());
  const routes = [
    runtime.authRoutes,
    createCatalogRoutes({ catalog: runtime.catalog }),
    createConversationRoutes({ conversations: runtime.conversationService, authService: runtime.authService, expectedOrigin: runtime.config.publicOrigin }),
    createOrderRoutes({ orders: runtime.orderService, authService: runtime.authService, checkoutService: runtime.checkoutService, expectedOrigin: runtime.config.publicOrigin }),
  ];
  async function dispatch(input) {
    const req = makeRequest(input);
    const res = makeResponse();
    const url = new URL(input.path, runtime.config.publicOrigin);
    for (const route of routes) if (await route(req, res, url)) return res;
    return res;
  }

  const register = await dispatch({ method: 'POST', path: '/api/auth/register', body: { email: 'flow@example.test', password: 'a long secure password' } });
  assert.equal(register.status, 201);
  const cookie = register.headers['set-cookie'].split(';')[0];
  const csrfToken = register.json().csrfToken;
  const catalog = await dispatch({ method: 'GET', path: '/api/catalog?q=grain' });
  assert.equal(catalog.json().items[0].id, 'northstar-grain-bowl');

  const created = await dispatch({ method: 'POST', path: '/api/conversations', cookie, csrf: csrfToken });
  assert.equal(created.status, 201);
  const conversationId = created.json().id;
  const first = await dispatch({ method: 'POST', path: `/api/conversations/${conversationId}/messages`, cookie, csrf: csrfToken, body: { text: 'Get two Northstar Grain Bowls' } });
  const second = await dispatch({ method: 'POST', path: `/api/conversations/${conversationId}/messages`, cookie, csrf: csrfToken, body: { text: 'Add one Crispy Chickpea Bowl' } });
  assert.equal(first.json().order.totalCents, 2500);
  assert.equal(second.json().order.items.length, 2);
  assert.equal(second.json().cart.totalCents, 3600);

  const orderId = second.json().order.id;
  const firstLine = second.json().order.items[0];
  const staleEdit = await dispatch({ method: 'PATCH', path: `/api/orders/${orderId}`, cookie, csrf: csrfToken, body: { expectedRevision: 1, quantity: 3 } });
  assert.equal(staleEdit.status, 409);
  const edited = await dispatch({ method: 'PATCH', path: `/api/orders/${orderId}`, cookie, csrf: csrfToken, body: { expectedRevision: second.json().order.revision, quantity: 3 } });
  assert.equal(edited.json().totalCents, 4850);
  assert.equal(firstLine.quantity, 2);

  const hidden = await dispatch({ method: 'GET', path: `/api/conversations/${conversationId}` });
  assert.equal(hidden.status, 401);
  const checkout = await dispatch({ method: 'POST', path: `/api/orders/${orderId}/checkout`, cookie, csrf: csrfToken, body: { expectedRevision: edited.json().revision } });
  assert.equal(checkout.status, 503);
  const logout = await dispatch({ method: 'POST', path: '/api/auth/logout', cookie, csrf: csrfToken, body: {} });
  assert.equal(logout.status, 200);
  const afterLogout = await dispatch({ method: 'GET', path: `/api/orders/${orderId}`, cookie });
  assert.equal(afterLogout.status, 401);
});
