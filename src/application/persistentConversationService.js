import { parseCatalogIntent } from '../domain/catalogIntent.js';

const GREETING = 'Hi, I can help put together an order. Tell me a menu item and quantity, and I will keep the cart details together.';

export function createPersistentConversationService({ conversations, orders, catalog, checkoutService = null }) {
  if (!conversations || !orders || !catalog) throw new TypeError('Conversation, order, and catalog repositories are required');

  function orderView(order) {
    if (!order) return null;
    const restaurants = catalog.listActive();
    const restaurant = restaurants.find((entry) => entry.id === order.restaurantId);
    const lines = order.items.map((line) => ({
      id: line.id,
      item: { id: line.item.id, name: line.item.name, unitPriceCents: line.unitPriceCents },
      quantity: line.quantity,
      modifiers: line.modifiers,
      lineTotalCents: line.lineTotalCents,
    }));
    const item = catalog.findItem(order.item.id);
    return {
      id: order.id,
      restaurant: restaurant ? { id: restaurant.id, name: restaurant.name } : { id: order.restaurantId, name: 'Restaurant' },
      item: { id: order.item.id, name: order.item.name, unitPriceCents: order.unitPriceCents },
      quantity: order.quantity,
      modifiers: order.modifiers,
      status: order.status,
      revision: order.revision,
      subtotalCents: order.subtotalCents,
      totalCents: order.totalCents,
      currency: order.currency,
      requiredOptions: item?.modifiers.filter((modifier) => modifier.required) ?? [],
      items: lines,
    };
  }

  function cartView(order) {
    if (!order) return null;
    return {
      currency: order.currency,
      lineItems: order.items.map((line) => ({
        itemId: line.item.id,
        name: line.item.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        totalCents: line.lineTotalCents,
        modifiers: line.modifiers,
      })),
      subtotalCents: order.subtotalCents,
      totalCents: order.totalCents,
      taxCents: null,
      deliveryFeeCents: null,
      pricingNote: 'Tax, delivery, and restaurant availability are not included in this checkout.',
    };
  }

  function response(conversation, order, reply) {
    const view = orderView(order);
    return {
      conversation: {
        id: conversation.id,
        messages: conversation.messages,
        updatedAt: conversation.updatedAt,
      },
      conversationId: conversation.id,
      reply,
      order: view,
      cart: cartView(order),
      checkout: null,
    };
  }

  return Object.freeze({
    createConversation(userId) {
      if (!userId) throw codedError('unauthenticated', 'Sign in is required.');
      const conversation = conversations.create({ userId, state: { orderId: null }, initialMessage: GREETING });
      return { id: conversation.id, reply: GREETING, messages: conversation.messages };
    },

    getConversation(userId, conversationId) {
      const conversation = conversations.findOwned(conversationId, userId);
      if (!conversation) throw codedError('not_found', 'Conversation was not found.');
      const savedOrder = conversation.state.orderId ? orders.findOwned(conversation.state.orderId, userId) : null;
      const order = savedOrder?.status === 'canceled' ? null : savedOrder;
      return response(conversation, order, null);
    },

    listConversations(userId, options) {
      const page = conversations.listOwned(userId, options);
      return {
        ...page,
        items: page.items.map((conversation) => {
          const order = conversation.state.orderId ? orders.findOwned(conversation.state.orderId, userId) : null;
          return {
            id: conversation.id,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            latestMessage: conversation.latestMessage,
            order: order ? { id: order.id, status: order.status, totalCents: order.totalCents, currency: order.currency } : null,
          };
        }),
      };
    },

    sendMessage({ userId, conversationId, text }) {
      if (!userId) throw codedError('unauthenticated', 'Sign in is required.');
      if (typeof text !== 'string' || !text.trim() || text.trim().length > 2000) {
        throw codedError('invalid_message', 'Message must contain 1 to 2,000 characters.');
      }
      const conversation = conversations.findOwned(conversationId, userId);
      if (!conversation) throw codedError('not_found', 'Conversation was not found.');
      const savedOrder = conversation.state.orderId ? orders.findOwned(conversation.state.orderId, userId) : null;
      const currentOrder = savedOrder?.status === 'canceled' ? null : savedOrder;
      const currentIntentOrder = currentOrder ? {
        itemId: currentOrder.item.id,
        modifierIds: currentOrder.modifiers.map((modifier) => modifier.id),
        lines: currentOrder.items.map((line) => ({ itemId: line.item.id, modifierIds: line.modifiers.map((modifier) => modifier.id) })),
      } : null;
      const catalogSnapshot = catalog.listActive();
      const intent = parseCatalogIntent(text.trim(), currentIntentOrder, catalogSnapshot);
      const state = { ...conversation.state };
      let nextOrder = currentOrder;
      let mutation = null;
      let reply;

      if (intent.type === 'start_order') {
        const item = catalog.findItem(intent.itemId);
        if (!item) {
          reply = 'That menu item is not currently available.';
        } else if (!Number.isInteger(intent.quantity) || intent.quantity < 1 || intent.quantity > 20) {
          reply = 'Choose a quantity from 1 to 20.';
        } else {
          mutation = () => { nextOrder = orders.create({ userId, conversationId, item, quantity: intent.quantity }); };
          reply = `${intent.quantity} × ${item.name} is in your cart. You can change the quantity, add an available option, or continue to checkout.`;
        }
      } else if (intent.type === 'set_quantity') {
        if (!currentOrder) reply = 'Tell me the menu item you want first.';
        else {
          mutation = () => { nextOrder = orders.edit({ userId, orderId: currentOrder.id, expectedRevision: currentOrder.revision, quantity: intent.quantity }); };
          reply = `Quantity updated to ${intent.quantity}.`;
        }
      } else if (intent.type === 'invalid_quantity') {
        reply = 'Choose a quantity from 1 to 20.';
      } else if (intent.type === 'add_item') {
        const item = catalog.findItem(intent.itemId);
        if (!currentOrder) reply = 'Tell me the menu item you want first.';
        else if (!item) reply = 'That menu item is not currently available.';
        else {
          mutation = () => { nextOrder = orders.addItem({ userId, orderId: currentOrder.id, expectedRevision: currentOrder.revision, item, quantity: intent.quantity }); };
          reply = `Added ${intent.quantity} × ${item.name} to your cart.`;
        }
      } else if (intent.type === 'set_modifiers') {
        if (!currentOrder) reply = 'Tell me the menu item you want first.';
        else {
          mutation = () => { nextOrder = orders.edit({ userId, orderId: currentOrder.id, expectedRevision: currentOrder.revision, modifierIds: intent.modifierIds }); };
          reply = 'Your available options have been updated.';
        }
      } else if (intent.type === 'cancel') {
        if (!currentOrder) reply = 'There is no open order to cancel.';
        else {
          mutation = () => { orders.cancel({ userId, orderId: currentOrder.id, expectedRevision: currentOrder.revision }); nextOrder = null; };
          reply = 'Your open order has been canceled.';
        }
      } else if (intent.type === 'checkout') {
        if (!currentOrder) reply = 'Add a menu item before continuing to checkout.';
        else if (!checkoutService) reply = 'Online checkout is not available right now.';
        else reply = 'Checkout is ready.';
      } else {
        const example = catalogSnapshot.flatMap((restaurant) => restaurant.items).map((item) => item.name).slice(0, 3).join(', ');
        reply = `I can help with an item in the current menu. Try ${example}.`;
      }

      if (intent.type === 'checkout' && currentOrder && checkoutService) {
        mutation = () => { nextOrder = checkoutService.createCheckout({ userId, orderId: currentOrder.id, expectedRevision: currentOrder.revision }); };
      }
      const updated = conversations.appendTurn({
        id: conversationId,
        userId,
        expectedUpdatedAt: conversation.updatedAt,
        userText: text.trim(),
        assistantText: reply,
        state,
        persist: () => {
          mutation?.();
          state.orderId = nextOrder?.id ?? null;
        },
      });
      return response(updated, nextOrder, reply);
    },
  });
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
