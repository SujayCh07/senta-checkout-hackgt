import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createCatalogRoutes } from '../src/http/routes/catalogRoutes.js';
import { createConversationRoutes } from '../src/http/routes/conversationRoutes.js';
import { createOrderRoutes } from '../src/http/routes/orderRoutes.js';

function request({ method, path, body = {}, csrf = null, user = 'owner' }) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = path;
  req.headers = { host: 'localhost:3002', origin: 'http://localhost:3002', 'content-type': 'application/json', cookie: `senta_session=${'a'.repeat(64)}` };
  if (csrf) req.headers['x-csrf-token'] = csrf;
  req.socket = { remoteAddress: '127.0.0.1' };
  req.user = user;
  return req;
}

function response() {
  return {
    headers: {},
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(text) { this.text = text; },
    json() { return JSON.parse(this.text); },
  };
}

function authService(currentUser = 'owner') {
  return { current: () => currentUser === 'anonymous' ? null : { id: currentUser, csrfToken: 'c'.repeat(64) } };
}

test('catalog route validates bounded search parameters and returns active menu matches', () => {
  const route = createCatalogRoutes({ catalog: { listActive: () => [{ id: 'r', name: 'Kitchen', items: [{ id: 'bowl', name: 'Grain Bowl' }] }] } });
  const searchResponse = response();
  assert.equal(route(request({ method: 'GET', path: '/api/catalog?q=grain' }), searchResponse, new URL('http://localhost:3002/api/catalog?q=grain')), true);
  assert.equal(searchResponse.json().items[0].id, 'bowl');
  const invalidResponse = response();
  route(request({ method: 'GET', path: '/api/catalog?limit=1000' }), invalidResponse, new URL('http://localhost:3002/api/catalog?limit=1000'));
  assert.equal(invalidResponse.status, 400);
});

test('conversation routes require an owner session and CSRF for creation and messages', async () => {
  const calls = [];
  const conversations = {
    createConversation: (userId) => { calls.push(['create', userId]); return { id: 'conversation-id' }; },
    getConversation: (userId, id) => ({ owner: userId, id }),
    listConversations: (userId, options) => ({ userId, options, items: [] }),
    sendMessage: (input) => { calls.push(['message', input.userId]); return { reply: 'ok' }; },
  };
  const route = createConversationRoutes({ conversations, authService: authService(), expectedOrigin: 'http://localhost:3002' });
  const blocked = response();
  await route(request({ method: 'POST', path: '/api/conversations' }), blocked, new URL('http://localhost:3002/api/conversations'));
  assert.equal(blocked.status, 403);
  const created = response();
  await route(request({ method: 'POST', path: '/api/conversations', csrf: 'c'.repeat(64) }), created, new URL('http://localhost:3002/api/conversations'));
  assert.equal(created.status, 201);
  assert.deepEqual(calls[0], ['create', 'owner']);
  const wrongOrigin = response();
  const badRequest = request({ method: 'POST', path: '/api/conversations' });
  badRequest.headers.origin = 'https://evil.example.test';
  badRequest.headers['x-csrf-token'] = 'c'.repeat(64);
  await route(badRequest, wrongOrigin, new URL('http://localhost:3002/api/conversations'));
  assert.equal(wrongOrigin.status, 403);
  const history = response();
  await route(request({ method: 'GET', path: '/api/conversations?limit=4' }), history, new URL('http://localhost:3002/api/conversations?limit=4'));
  assert.equal(history.status, 200);
  assert.equal(history.json().options.limit, 4);
});

test('order routes carry the authenticated owner and expected revision into mutations', async () => {
  const calls = [];
  const orders = {
    get: (input) => ({ id: input.orderId, userId: input.userId }),
    editLine: (input) => { calls.push(input); return { id: input.orderId, revision: 2 }; },
    addMenuItem: (input) => input,
    removeLine: (input) => input,
    cancel: (input) => ({ id: input.orderId, status: 'canceled' }),
  };
  const route = createOrderRoutes({ orders, authService: authService(), expectedOrigin: 'http://localhost:3002' });
  const updated = response();
  const path = `/api/orders/${'b'.repeat(36)}`;
  await route(request({ method: 'PATCH', path, csrf: 'c'.repeat(64), body: { expectedRevision: 1, quantity: 3 } }), updated, new URL(`http://localhost:3002${path}`));
  assert.equal(updated.status, 200);
  assert.equal(calls[0].userId, 'owner');
  assert.equal(calls[0].expectedRevision, 1);
  assert.equal(calls[0].quantity, 3);
});
