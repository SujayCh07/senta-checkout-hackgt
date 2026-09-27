import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionToken(userId, now = Date.now()) {
  if (typeof userId !== 'string' || !userId) throw new TypeError('A user id is required');
  const rawToken = randomBytes(32).toString('hex');
  return {
    id: randomUUID(),
    rawToken,
    tokenHash: hashSessionToken(rawToken),
    csrfToken: randomBytes(32).toString('hex'),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
}

export function hashSessionToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}
