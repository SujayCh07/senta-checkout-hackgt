import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { readJsonBody, readRawBody } from '../src/http/body.js';

function requestFor(chunks, contentType = 'application/json') {
  const request = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
  request.headers = { 'content-type': contentType };
  return request;
}

test('JSON body reader accepts chunked objects and rejects non-object values', async () => {
  assert.deepEqual(await readJsonBody(requestFor(['{"name":', '"bowl"}'])), { name: 'bowl' });
  await assert.rejects(readJsonBody(requestFor(['[]'])), { code: 'invalid_json' });
  await assert.rejects(readJsonBody(requestFor(['null'])), { code: 'invalid_json' });
});

test('JSON body reader requires JSON content type and enforces the byte limit while streaming', async () => {
  await assert.rejects(readJsonBody(requestFor(['{}'], 'text/plain')), { code: 'unsupported_media_type' });
  await assert.rejects(readJsonBody(requestFor(['{"x":"12345"}']), 8), { code: 'body_too_large' });
  assert.deepEqual(await readJsonBody(requestFor(['{}']), 2), {});
});

test('raw body reader preserves exact bytes for webhook signature validation', async () => {
  const bytes = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x31, 0x7d]);
  const actual = await readRawBody(Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]));
  assert.deepEqual(actual, bytes);
  await assert.rejects(readRawBody(Readable.from([Buffer.alloc(20)]), 8), { code: 'body_too_large' });
});
