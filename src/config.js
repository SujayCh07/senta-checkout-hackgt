import { resolve } from 'node:path';

export function loadConfig(env = process.env) {
  return Object.freeze({
    host: env.HOST || '127.0.0.1',
    port: parsePort(env.PORT || '3002'),
    databasePath: resolve(env.DATABASE_PATH || 'data/senta-checkout.sqlite'),
    busyTimeoutMs: parsePositiveInteger(env.SQLITE_BUSY_TIMEOUT_MS || '5000'),
    sessionCookieName: 'senta_session',
    isProduction: env.NODE_ENV === 'production',
  });
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
