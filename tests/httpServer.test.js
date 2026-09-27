import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRuntime } from '../src/runtime.js';
import { createSentaServer } from '../src/server.js';

const baseUrl = 'http://localhost:3002';
const originHeaders = { origin: baseUrl };

test('HTTP checkout foundation requires auth, persists owned orders, and enforces CSRF', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'senta-http-'));
  const databasePath = join(directory, 'http.sqlite');
  const runtime = createRuntime({ databasePath });
  const server = createSentaServer({ runtime });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(3002, '127.0.0.1', resolve);
    });
  } catch (error) {
    runtime.close();
    await rm(directory, { recursive: true, force: true });
    if (error.code === 'EPERM') return t.skip('Sandbox denied binding localhost:3002.');
    throw error;
  }
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    runtime.close();
    await rm(directory, { recursive: true, force: true });
  });

  const catalogResponse = await fetch(`${baseUrl}/api/catalog`);
  assert.equal(catalogResponse.status, 200);
  assert.equal((await catalogResponse.json()).restaurants[0].items.length, 3);
  const blocked = await fetch(`${baseUrl}/api/conversations`, { method: 'POST', headers: originHeaders });
  assert.equal(blocked.status, 401);

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { ...originHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'browser@example.test', password: 'a long secure password' }),
  });
  assert.equal(registration.status, 201);
  const { csrfToken } = await registration.json();
  const cookie = registration.headers.get('set-cookie').split(';')[0];

  const created = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST', headers: { ...originHeaders, cookie, 'x-csrf-token': csrfToken },
  });
  assert.equal(created.status, 201);
  const conversation = await created.json();
  const message = await fetch(`${baseUrl}/api/conversations/${conversation.id}/messages`, {
    method: 'POST', headers: { ...originHeaders, cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Get two Northstar Grain Bowls' }),
  });
  assert.equal(message.status, 200);
  const result = await message.json();
  assert.equal(result.order.quantity, 2);
  assert.equal(result.order.totalCents, 2500);
  assert.equal(result.conversation.messages.length, 3);

  const ownerRead = await fetch(`${baseUrl}/api/conversations/${conversation.id}`, { headers: { cookie } });
  assert.equal(ownerRead.status, 200);
  const csrfRejected = await fetch(`${baseUrl}/api/orders/${result.order.id}`, {
    method: 'PATCH', headers: { ...originHeaders, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: result.order.revision, quantity: 3 }),
  });
  assert.equal(csrfRejected.status, 403);

  const other = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { ...originHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'other@example.test', password: 'another long password' }),
  });
  const otherCookie = other.headers.get('set-cookie').split(';')[0];
  const hiddenOrder = await fetch(`${baseUrl}/api/orders/${result.order.id}`, { headers: { cookie: otherCookie } });
  assert.equal(hiddenOrder.status, 404);
});
