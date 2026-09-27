let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = typeof token === 'string' ? token : null;
}

export async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) && csrfToken) {
    requestHeaders.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const error = new Error(payload.error || 'The request could not be completed.');
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

export async function authenticate(path, credentials) {
  const result = await request(path, { method: 'POST', body: credentials });
  setCsrfToken(result.csrfToken);
  return result;
}

export async function restoreSession() {
  const result = await request('/api/auth/me');
  setCsrfToken(result.csrfToken);
  return result;
}

export async function signOut() {
  await request('/api/auth/logout', { method: 'POST', body: {} });
  setCsrfToken(null);
}
