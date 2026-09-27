import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCsrf, assertSameOrigin, parseCookieHeader, readSessionToken, sessionCookie } from '../src/http/security.js';
import { createSessionToken } from '../src/infrastructure/sessions.js';

test('cookie parser handles ordinary values and rejects malformed encoding or duplicate names', () => {
  assert.deepEqual({ ...parseCookieHeader('a=1; senta_session=token%2Dvalue') }, { a: '1', senta_session: 'token-value' });
  assert.throws(() => parseCookieHeader('senta_session=%E0%A4%A'), { code: 'invalid_cookie' });
  assert.throws(() => parseCookieHeader('senta_session=one; senta_session=two'), { code: 'invalid_cookie' });
  assert.equal(readSessionToken({ headers: { cookie: 'other=value' } }), null);
});

test('session cookie flags support secure production and clear operations', () => {
  const token = createSessionToken('user-1').rawToken;
  const cookie = sessionCookie(token, { secure: true });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(sessionCookie('', { clear: true }), /Max-Age=0/);
  assert.throws(() => sessionCookie('not-a-session-token'), TypeError);
});

test('same-origin and CSRF checks fail closed on cross-origin or mismatched tokens', () => {
  assert.doesNotThrow(() => assertSameOrigin({ headers: { origin: 'https://shop.example.test' } }, 'https://shop.example.test'));
  assert.throws(() => assertSameOrigin({ headers: { origin: 'https://evil.example.test' } }, 'https://shop.example.test'), { code: 'origin_rejected' });
  const session = { csrfToken: 'a'.repeat(64) };
  assert.doesNotThrow(() => assertCsrf({ headers: { 'x-csrf-token': session.csrfToken } }, session));
  for (const supplied of [undefined, 'short', 'b'.repeat(64)]) {
    assert.throws(() => assertCsrf({ headers: { 'x-csrf-token': supplied } }, session), { code: 'csrf_rejected' });
  }
});
