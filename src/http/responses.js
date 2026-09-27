const STATUS_BY_CODE = new Map([
  ['invalid_email', 400], ['invalid_password', 400], ['invalid_json', 400],
  ['unsupported_media_type', 415], ['body_too_large', 413], ['origin_rejected', 403],
  ['csrf_rejected', 403], ['invalid_cookie', 400], ['email_in_use', 409],
  ['invalid_credentials', 401], ['unauthenticated', 401], ['not_found', 404], ['invalid_message', 400],
  ['revision_conflict', 409], ['invalid_order', 422], ['payment_unavailable', 503],
  ['order_locked', 409], ['item_unavailable', 409],
  ['attempt_conflict', 409], ['invalid_webhook_signature', 400], ['invalid_webhook', 400],
  ['stripe_rejected', 502], ['ambiguous_checkout', 503],
  ['rate_limited', 429], ['payment_unavailable', 503],
  ['invalid_pagination', 400], ['invalid_cursor', 400],
  ['price_changed', 409],
]);

export function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(payload));
}

export function sendError(response, error) {
  const status = STATUS_BY_CODE.get(error?.code) ?? error?.statusCode ?? 500;
  const message = status >= 500 ? 'The request could not be completed.' : error.message;
  sendJson(response, status, { error: message, code: error?.code ?? 'internal_error' });
}

export function errorStatus(code) {
  return STATUS_BY_CODE.get(code) ?? 500;
}
