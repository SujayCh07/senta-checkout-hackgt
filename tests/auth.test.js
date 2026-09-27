import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAuthService } from '../src/application/authService.js';
import { openDatabase } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';
import { createSessionToken } from '../src/infrastructure/sessions.js';
import { hashPassword, verifyPassword } from '../src/infrastructure/passwords.js';
import { createSessionRepository } from '../src/persistence/sessionRepository.js';
import { createUserRepository } from '../src/persistence/userRepository.js';

async function fixture(t, now = 1_800_000_000_000) {
  const directory = await mkdtemp(join(tmpdir(), 'senta-auth-'));
  const db = openDatabase({ path: join(directory, 'auth.sqlite') });
  runMigrations(db);
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  return { db, service: createAuthService({ users: createUserRepository(db), sessions: createSessionRepository(db), now: () => now }) };
}

test('scrypt password credentials verify without storing the original password', () => {
  const credential = hashPassword('correct horse battery staple');
  assert.equal(credential.algorithm, 'scrypt');
  assert.notEqual(credential.hash, 'correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', credential), true);
  assert.equal(verifyPassword('incorrect password', credential), false);
});

test('session token is random and only its digest is stored', () => {
  const first = createSessionToken('user-1', 1000);
  const second = createSessionToken('user-1', 1000);
  assert.notEqual(first.rawToken, second.rawToken);
  assert.equal(first.rawToken.length, 64);
  assert.equal(first.tokenHash.length, 64);
  assert.notEqual(first.rawToken, first.tokenHash);
});

test('registration normalizes email, rejects duplicates, and login authenticates', async (t) => {
  const { db, service } = await fixture(t);
  const { user: account, session } = service.register({ email: ' Person@Example.Test ', password: 'correct horse battery staple' });
  assert.equal(account.email, 'person@example.test');
  assert.ok(account.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.throws(() => service.register({ email: 'PERSON@example.test', password: 'another valid password' }), { code: 'email_in_use' });
  assert.equal(service.login({ email: 'PERSON@example.test', password: 'correct horse battery staple' }).user.id, account.id);
  assert.throws(() => service.login({ email: account.email, password: 'wrong password' }), { code: 'invalid_credentials' });
});

test('sessions persist only token hashes and expire or revoke cleanly', async (t) => {
  const { db, service } = await fixture(t, 100_000);
  const { user, session } = service.register({ email: 'a@example.test', password: 'correct horse battery staple' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(session.tokenHash).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(session.rawToken).n, 0);
  assert.equal(service.current(session.rawToken).id, user.id);
  const expired = createAuthService({ users: createUserRepository(db), sessions: createSessionRepository(db), now: () => Number(session.expiresAt) + 1 });
  assert.equal(expired.current(session.rawToken), null);
  service.logout(session.rawToken);
  assert.equal(service.current(session.rawToken), null);
});

test('cookie parsing rejects malformed and duplicate session cookies', async () => {
  const { parseCookieHeader, sessionCookie } = await import('../src/http/security.js');
  assert.equal(parseCookieHeader('x=1; senta_session=abc')?.senta_session, 'abc');
  assert.throws(() => parseCookieHeader('senta_session=a; senta_session=b'), { code: 'invalid_cookie' });
  assert.match(sessionCookie('a'.repeat(64), { secure: true }), /HttpOnly/);
  assert.match(sessionCookie('a'.repeat(64), { secure: true }), /Secure/);
  assert.match(sessionCookie('', { clear: true }), /Max-Age=0/);
});
