import { hashSessionToken } from '../infrastructure/sessions.js';
import { timingSafeEqual } from 'node:crypto';

export function parseCookieHeader(header = '') {
  const cookies = Object.create(null);
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
    let value;
    try { value = decodeURIComponent(raw); } catch { throw codedError('invalid_cookie', 'Invalid cookie encoding.'); }
    if (Object.hasOwn(cookies, name)) throw codedError('invalid_cookie', 'Duplicate cookies are not accepted.');
    cookies[name] = value;
  }
  return cookies;
}

export function sessionCookie(token, { name = 'senta_session', secure = false, clear = false } = {}) {
  const value = clear ? '' : token;
  if (!clear && !hashSessionToken(value)) throw new TypeError('Session token must be a 32-byte hex value');
  const attributes = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) attributes.push('Secure');
  if (clear) attributes.push('Max-Age=0');
  else attributes.push('Max-Age=2592000');
  return attributes.join('; ');
}

export function readSessionToken(request, name = 'senta_session') {
  return parseCookieHeader(request.headers.cookie || '')[name] ?? null;
}

export function authenticateRequest(request, authService, name = 'senta_session') {
  return authService.current(readSessionToken(request, name));
}

export function assertSameOrigin(request, expectedOrigin) {
  const origin = request.headers.origin;
  if (origin !== expectedOrigin) throw codedError('origin_rejected', 'Request origin is not allowed.');
}

export function assertCsrf(request, session) {
  const supplied = request.headers['x-csrf-token'];
  if (typeof supplied !== 'string' || !session || supplied.length !== session.csrfToken?.length) {
    throw codedError('csrf_rejected', 'Request verification failed.');
  }
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken))) {
    throw codedError('csrf_rejected', 'Request verification failed.');
  }
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
