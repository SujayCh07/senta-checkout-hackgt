import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationService } from '../src/application/conversationService.js';

function startConversation() {
  const service = createConversationService();
  const conversation = service.createConversation();
  return { service, conversationId: conversation.id };
}

test('a natural-language request creates the requested merchant, item, and quantity', () => {
  const { service, conversationId } = startConversation();

  const result = service.sendMessage(conversationId, 'Get me 2 Crunchwrap Supremes from Taco Bell');

  assert.equal(result.order.merchant.name, 'Taco Bell');
  assert.equal(result.order.item.name, 'Crunchwrap Supreme');
  assert.equal(result.order.quantity, 2);
  assert.equal(result.order.status, 'needs_modifier');
  assert.match(result.reply, /tomatoes/i);
});

test('a required modifier completes the order and checkout uses a fake provider', () => {
  const { service, conversationId } = startConversation();
  service.sendMessage(conversationId, 'Get me a Crunchwrap Supreme from Taco Bell');

  const modifier = service.sendMessage(conversationId, 'no tomatoes');
  assert.equal(modifier.order.modifiers.tomatoes, 'none');
  assert.equal(modifier.order.status, 'ready_for_checkout');

  const checkout = service.sendMessage(conversationId, 'checkout');
  assert.equal(checkout.order.status, 'checkout_created');
  assert.match(checkout.checkout.url, /^http:\/\/localhost:3002\/checkout\//);
  assert.equal(checkout.checkout.paymentStatus, 'not_paid');
});

test('checkout is not created until required modifiers are answered', () => {
  const { service, conversationId } = startConversation();
  service.sendMessage(conversationId, 'Get me a Crunchwrap Supreme from Taco Bell');

  const result = service.sendMessage(conversationId, 'checkout');

  assert.equal(result.order.status, 'needs_modifier');
  assert.equal(result.checkout, null);
  assert.match(result.reply, /tomatoes/i);
});

test('quantity and item corrections preserve intended state and invalidate checkout', () => {
  const { service, conversationId } = startConversation();
  service.sendMessage(conversationId, 'Get me 2 Crunchwrap Supremes from Taco Bell');
  service.sendMessage(conversationId, 'no tomatoes');
  const checkout = service.sendMessage(conversationId, 'checkout');

  const quantity = service.sendMessage(conversationId, 'make it 3');
  assert.equal(service.getCheckout(checkout.checkout.id).status, 'expired');
  assert.equal(service.completeCheckout(checkout.checkout.id), null);
  assert.equal(quantity.order.quantity, 3);
  assert.equal(quantity.order.status, 'ready_for_checkout');
  assert.equal(quantity.checkout, null);

  const variant = service.sendMessage(conversationId, 'actually the black bean one');
  assert.equal(variant.order.item.name, 'Black Bean Crunchwrap Supreme');
  assert.equal(variant.order.quantity, 3);
  assert.equal(variant.order.status, 'needs_modifier');
  assert.equal(variant.checkout, null);
});

test('cancellation clears the current order before a new order starts', () => {
  const { service, conversationId } = startConversation();
  service.sendMessage(conversationId, 'Get me 2 Crunchwrap Supremes from Taco Bell');

  const cancelled = service.sendMessage(conversationId, 'forget my order');
  assert.equal(cancelled.order, null);
  assert.match(cancelled.reply, /cleared|forgotten|cancelled/i);

  const next = service.sendMessage(conversationId, 'Get me a Black Bean Crunchwrap from Taco Bell');
  assert.equal(next.order.item.name, 'Black Bean Crunchwrap Supreme');
  assert.equal(next.order.quantity, 1);
  assert.equal(next.order.modifiers.tomatoes, null);
});

test('a completed demo checkout cannot be cancelled or edited in place', () => {
  const { service, conversationId } = startConversation();
  service.sendMessage(conversationId, 'Get me a Crunchwrap Supreme from Taco Bell');
  service.sendMessage(conversationId, 'no tomatoes');
  const checkout = service.sendMessage(conversationId, 'checkout');
  service.completeCheckout(checkout.checkout.id);
  assert.equal(service.completeCheckout(checkout.checkout.id), null);

  const result = service.sendMessage(conversationId, 'forget my order');

  assert.equal(result.order.status, 'simulated_paid');
  assert.equal(result.order.item.name, 'Crunchwrap Supreme');
  assert.match(result.reply, /complete/i);
});
