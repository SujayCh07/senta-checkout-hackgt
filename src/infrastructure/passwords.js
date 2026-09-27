import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 64;
const SCRYPT_OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password.normalize('NFKC'), salt, KEY_BYTES, SCRYPT_OPTIONS).toString('hex');
  return { algorithm: 'scrypt', salt, hash };
}

export function verifyPassword(password, credential) {
  if (typeof password !== 'string' || !credential || credential.algorithm !== 'scrypt') return false;
  if (!/^[a-f0-9]{32}$/i.test(credential.salt) || !/^[a-f0-9]{128}$/i.test(credential.hash)) return false;
  const candidate = scryptSync(password.normalize('NFKC'), credential.salt, KEY_BYTES, SCRYPT_OPTIONS);
  const expected = Buffer.from(credential.hash, 'hex');
  return timingSafeEqual(candidate, expected);
}

export function validatePassword(password) {
  if (typeof password !== 'string') throw codedError('invalid_password', 'Password is required.');
  const normalized = password.normalize('NFKC');
  if (normalized.length < 12 || Buffer.byteLength(normalized) > 1024) {
    throw codedError('invalid_password', 'Password must contain at least 12 characters.');
  }
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
