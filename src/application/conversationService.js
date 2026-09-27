import { buildCart } from '../domain/cart.js';
import { parseFoodIntent } from '../domain/intentParser.js';
import { createOrder, missingRequiredModifier, replaceOrderItem, setOrderModifier, setOrderQuantity } from '../domain/order.js';
import { createInMemoryConversationStore } from '../adapters/inMemoryConversationStore.js';
import { createMockCheckoutProvider } from '../adapters/mockCheckoutProvider.js';
import { createMockMenuCatalog } from '../adapters/mockMenuCatalog.js';

const MAX_QUANTITY = 20;

function publicOrder(order) {
  return order ? structuredClone(order) : null;
}

export function createConversationService({
  store = createInMemoryConversationStore(),
  catalog = createMockMenuCatalog(),
  checkoutProvider = createMockCheckoutProvider(),
} = {}) {
  function response(conversation, reply) {
    const order = publicOrder(conversation.order);
    const cart = order ? buildCart(order) : null;
    return {
      conversationId: conversation.id,
      reply,
      order,
      cart,
      checkout: order?.checkout ?? null,
    };
  }

  function invalidateCheckout(order) {
    if (order?.checkout) checkoutProvider.expireSession(order.checkout.id);
    if (order) order.checkout = null;
  }

  return {
    createConversation() {
      const conversation = store.create();
      return {
        id: conversation.id,
        reply: 'Hi, I can help put together a food order. Tell me what you want and where you want it from.',
      };
    },

    sendMessage(conversationId, text) {
      const conversation = store.get(conversationId);
      if (!conversation) throw Object.assign(new Error('Conversation was not found.'), { statusCode: 404 });
      if (typeof text !== 'string' || !text.trim()) {
        throw Object.assign(new Error('Message text is required.'), { statusCode: 400 });
      }

      const cleanText = text.trim();
      conversation.messages.push({ role: 'user', text: cleanText });
      const intent = parseFoodIntent(cleanText, conversation.order);
      let reply;

      if (conversation.order?.status === 'simulated_paid') {
        reply = 'That demo checkout is complete. Start a new conversation to build another order.';
      } else if (intent.type === 'cancel') {
        invalidateCheckout(conversation.order);
        conversation.order = null;
        reply = 'Your order is cleared. You can start a new one whenever you are ready.';
      } else if (intent.type === 'start_order') {
        const merchant = catalog.findMerchant(intent.query);
        const item = merchant && catalog.findItem(merchant.id, intent.query);
        if (!merchant) {
          reply = 'I could not find that restaurant in the demo catalog. Try Taco Bell.';
        } else if (!item) {
          reply = `I found ${merchant.name}, but not that menu item. Try a Crunchwrap Supreme.`;
        } else {
          conversation.order = createOrder({ merchant, item, quantity: intent.quantity });
          reply = 'Which tomatoes option do you want: regular, no tomatoes, or extra tomatoes?';
        }
      } else if (!conversation.order) {
        reply = 'Start with a restaurant and menu item, such as “Get me 2 Crunchwrap Supremes from Taco Bell.”';
      } else if (intent.type === 'set_quantity') {
        if (!Number.isInteger(intent.quantity) || intent.quantity < 1 || intent.quantity > MAX_QUANTITY) {
          reply = `Please choose a quantity from 1 to ${MAX_QUANTITY}.`;
        } else {
          invalidateCheckout(conversation.order);
          conversation.order = setOrderQuantity(conversation.order, intent.quantity);
          reply = `Got it, ${intent.quantity} ${conversation.order.item.name}${intent.quantity === 1 ? '' : 's'}.`;
        }
      } else if (intent.type === 'replace_item') {
        const item = catalog.findItem(conversation.order.merchant.id, intent.query);
        if (!item) {
          reply = `I could not find that item at ${conversation.order.merchant.name}. Your current item is unchanged.`;
        } else {
          invalidateCheckout(conversation.order);
          conversation.order = replaceOrderItem(conversation.order, item);
          reply = `Updated to ${item.name}. Which tomatoes option do you want: regular, no tomatoes, or extra tomatoes?`;
        }
      } else if (intent.type === 'set_modifier') {
        if (!conversation.order.item.requiredModifiers.includes(intent.key)) {
          reply = 'That customization is not available for this item.';
        } else {
          invalidateCheckout(conversation.order);
          conversation.order = setOrderModifier(conversation.order, intent.key, intent.value);
          reply = `Updated: ${intent.value === 'none' ? 'no tomatoes' : `${intent.value} tomatoes`}. Your cart is ready to review or check out.`;
        }
      } else if (intent.type === 'checkout') {
        const required = missingRequiredModifier(conversation.order);
        if (required) {
          reply = 'Before checkout, please answer the required tomatoes customization: regular, no tomatoes, or extra tomatoes.';
        } else {
          const cart = buildCart(conversation.order);
          conversation.order.checkout ??= checkoutProvider.createSession(cart);
          conversation.order.status = 'checkout_created';
          reply = `Your ${conversation.order.item.name} cart is ready. Open the demo checkout to continue.`;
        }
      } else {
        reply = 'I can update the quantity, change the Crunchwrap, choose a tomatoes option, or start checkout.';
      }

      conversation.messages.push({ role: 'assistant', text: reply });
      store.save(conversation);
      return response(conversation, reply);
    },

    getCheckout(checkoutId) {
      return checkoutProvider.getSession(checkoutId);
    },

    completeCheckout(checkoutId) {
      const session = checkoutProvider.completeSession(checkoutId);
      if (!session) return null;
      const conversation = store.findByCheckoutId(checkoutId);
      if (conversation?.order) {
        conversation.order.status = 'simulated_paid';
        conversation.order.checkout = session;
        store.save(conversation);
      }
      return session;
    },
  };
}
