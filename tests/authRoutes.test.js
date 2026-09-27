import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createAuthService } from '../src/application/authService.js';
import { openDatabase } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';
import { hashSessionToken } from '../src/infrastructure/sessions.js';
import { createSessionRepository } from '../src/persistence/sessionRepository.js';
import { createUserRepository } from '../src/persistence/userRepository.js';
import { createAuthRoutes } from '../src/http/routes/authRoutes.js';

function invoke(handler, { method, path, body = {}, headers = {}, cookie = '' }) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = path;
  request.headers = { host: 'localhost:3002', origin: 'http://localhost:3002', 'content-type': 'application/json', ...headers };
  if (cookie) request.headers.cookie = cookie;
  request.socket = {};
  const response = {
    headers: {},
    writeHead(status, headersOut) { this.status = status; Object.assign(this.headers, headersOut); },
    end(text) { this.text = text; },
  };
  return handler(request, response, new URL(path, 'http://localhost:3002')).then(() => ({
    status: response.status,
    headers: response.headers,
    body: JSON.parse(response.text),
  }));
}

test('HTTP auth routes issue an HttpOnly session and require CSRF to revoke it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'senta-auth-routes-'));
  const db = openDatabase({ path: join(directory, 'auth.sqlite') });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  runMigrations(db);
  const authService = createAuthService({ users: createUserRepository(db), sessions: createSessionRepository(db) });
  const routes = createAuthRoutes({ authService });

  const registered = await invoke(routes, { method: 'POST', path: '/api/auth/register', body: { email: 'web@example.test', password: 'a long secure password' } });
  assert.equal(registered.status, 201);
  assert.match(registered.headers['set-cookie'], /HttpOnly/);
  const rawCookie = registered.headers['set-cookie'].split(';')[0];
  const rawToken = rawCookie.split('=')[1];
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?').get(hashSessionToken(rawToken)).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?').get(rawToken).count, 0);
  const unauthenticated = await invoke(routes, { method: 'GET', path: '/api/auth/me' });
  assert.equal(unauthenticated.status, 401);
  const authenticated = await invoke(routes, { method: 'GET', path: '/api/auth/me', cookie: rawCookie });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.body.user.email, 'web@example.test');
  const rejectedLogout = await invoke(routes, { method: 'POST', path: '/api/auth/logout', cookie: rawCookie });
  assert.equal(rejectedLogout.status, 403);
  const logout = await invoke(routes, {
    method: 'POST', path: '/api/auth/logout', cookie: rawCookie,
    headers: { 'x-csrf-token': authenticated.body.csrfToken },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'], /Max-Age=0/);
});
