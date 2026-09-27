import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('configuration defaults to localhost:3002 and an ignored file-backed database', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3002);
  assert.equal(config.publicOrigin, 'http://localhost:3002');
  assert.match(config.databasePath, /data\/senta-checkout\.sqlite$/);
  assert.equal(config.stripeSecretKey, '');
  assert.equal(config.stripeWebhookSecret, '');
});

test('configuration accepts local in-memory database and production HTTPS origin', () => {
  const config = loadConfig({ DATABASE_PATH: ':memory:', PUBLIC_ORIGIN: 'https://checkout.example.com', NODE_ENV: 'production' });
  assert.equal(config.databasePath, ':memory:');
  assert.equal(config.publicOrigin, 'https://checkout.example.com');
  assert.equal(config.isProduction, true);
});

test('configuration rejects invalid port, timeout, and unsafe public origins', () => {
  assert.throws(() => loadConfig({ PORT: '3001.5' }), /PORT/);
  assert.throws(() => loadConfig({ SQLITE_BUSY_TIMEOUT_MS: '0' }), /SQLITE_BUSY_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'http://example.com' }), /PUBLIC_ORIGIN/);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'https://example.com/path' }), /PUBLIC_ORIGIN/);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'https://user:pass@example.com' }), /PUBLIC_ORIGIN/);
});
