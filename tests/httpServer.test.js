import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentaDemoServer } from '../src/server.js';

const baseUrl = 'http://localhost:3002';

test('the local API creates an order and completes only a simulated checkout', async (t) => {
  const server = createSentaDemoServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3002, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Senta Checkout/);

  const createdResponse = await fetch(`${baseUrl}/api/conversations`, { method: 'POST' });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const send = (text) => fetch(`${baseUrl}/api/conversations/${created.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  await send('Get me 2 Crunchwrap Supremes from Taco Bell');
  await send('no tomatoes');
  const checkoutResponse = await send('checkout');
  const checkout = await checkoutResponse.json();
  assert.equal(checkoutResponse.status, 200);
  assert.match(checkout.checkout.url, /^http:\/\/localhost:3002\/checkout\//);

  const checkoutPage = await fetch(checkout.checkout.url);
  assert.equal(checkoutPage.status, 200);
  assert.match(await checkoutPage.text(), /Simulated checkout/);

  const completedResponse = await fetch(`${baseUrl}/api/mock-checkout/${checkout.checkout.id}/complete`, { method: 'POST' });
  assert.equal(completedResponse.status, 200);
  assert.equal((await completedResponse.json()).paymentStatus, 'simulated_paid');

  const unknownConversation = await fetch(`${baseUrl}/api/conversations/00000000-0000-4000-8000-000000000000/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  });
  assert.equal(unknownConversation.status, 404);
});
