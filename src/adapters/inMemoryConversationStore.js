import { randomUUID } from 'node:crypto';

export function createInMemoryConversationStore() {
  const conversations = new Map();

  return {
    create() {
      const conversation = { id: randomUUID(), order: null, messages: [] };
      conversations.set(conversation.id, conversation);
      return conversation;
    },

    get(id) {
      return conversations.get(id) ?? null;
    },

    findByCheckoutId(checkoutId) {
      return [...conversations.values()].find((conversation) => conversation.order?.checkout?.id === checkoutId) ?? null;
    },

    save(conversation) {
      conversations.set(conversation.id, conversation);
    },
  };
}
