import assert from 'node:assert/strict';
import test from 'node:test';
import { errorStatus, sendError, sendJson } from '../src/http/responses.js';

function response() {
  return { headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
}

test('JSON response helper sets a stable content type and allows explicit response headers', () => {
  const res = response();
  sendJson(res, 202, { state: 'unknown_state' }, { 'cache-control': 'no-store' });
  assert.equal(res.status, 202);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { state: 'unknown_state' });
});

test('known application failures map to stable status codes and hide unexpected errors', () => {
  assert.equal(errorStatus('invalid_order'), 422);
  assert.equal(errorStatus('not_found'), 404);
  assert.equal(errorStatus('rate_limited'), 429);
  assert.equal(errorStatus('unknown'), 500);
  const validation = response();
  sendError(validation, Object.assign(new Error('Quantity is invalid.'), { code: 'invalid_order' }));
  assert.equal(validation.status, 422);
  assert.deepEqual(JSON.parse(validation.body), { error: 'Quantity is invalid.', code: 'invalid_order' });
  const internal = response();
  sendError(internal, new Error('database path /private/secret.sqlite failed'));
  assert.equal(internal.status, 500);
  assert.equal(JSON.parse(internal.body).error, 'The request could not be completed.');
  assert.equal(JSON.parse(internal.body).error.includes('secret.sqlite'), false);
});
