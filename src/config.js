import { resolve } from 'node:path';

export function loadConfig(env = process.env) {
  const port = parsePort(env.PORT || '3002');
  const publicOrigin = parsePublicOrigin(env.PUBLIC_ORIGIN || `http://${env.PUBLIC_HOST || 'localhost'}:${port}`);
  return Object.freeze({
    host: env.HOST || '127.0.0.1',
    port,
    databasePath: env.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(env.DATABASE_PATH || 'data/senta-checkout.sqlite'),
    busyTimeoutMs: parsePositiveInteger(env.SQLITE_BUSY_TIMEOUT_MS || '5000'),
    sessionCookieName: 'senta_session',
    isProduction: env.NODE_ENV === 'production',
    publicOrigin,
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  });
}

function parsePublicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('PUBLIC_ORIGIN must be a valid origin URL'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('PUBLIC_ORIGIN must be an HTTPS origin or a local HTTP origin without a path');
  }
  return url.origin;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parsePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError('SQLITE_BUSY_TIMEOUT_MS must be a positive integer');
  }
  return number;
}
