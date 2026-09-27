export function createOrderService({ orders, catalog }) {
  if (!orders || !catalog) throw new TypeError('Order and catalog repositories are required');
  return Object.freeze({
    get({ userId, orderId }) {
      const order = orders.findOwned(orderId, userId);
      if (!order) throw codedError('not_found', 'Order was not found.');
      return order;
    },
    editLine({ userId, orderId, lineItemId, expectedRevision, quantity, modifierIds }) {
      requireRevision(expectedRevision);
      if (quantity === undefined && modifierIds === undefined) throw codedError('invalid_order', 'Provide a quantity or option change.');
      if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1 || quantity > 20)) throw codedError('invalid_order', 'Quantity must be between 1 and 20.');
      if (modifierIds !== undefined && (!Array.isArray(modifierIds) || modifierIds.length > 20 || modifierIds.some((id) => typeof id !== 'string'))) throw codedError('invalid_order', 'Option selection is invalid.');
      return orders.edit({ userId, orderId, lineItemId, expectedRevision, quantity, modifierIds });
    },
    addMenuItem({ userId, orderId, itemId, expectedRevision, quantity = 1, modifierIds = [] }) {
      requireRevision(expectedRevision);
      if (typeof itemId !== 'string' || !itemId) throw codedError('invalid_order', 'Menu item is required.');
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw codedError('invalid_order', 'Quantity must be between 1 and 20.');
      if (!Array.isArray(modifierIds) || modifierIds.length > 20 || modifierIds.some((id) => typeof id !== 'string')) throw codedError('invalid_order', 'Option selection is invalid.');
      const item = catalog.findItem(itemId);
      if (!item) throw codedError('item_unavailable', 'That menu item is not currently available.');
      return orders.addItem({ userId, orderId, expectedRevision, item, quantity, modifierIds });
    },
    removeLine({ userId, orderId, lineItemId, expectedRevision }) {
      requireRevision(expectedRevision);
      if (typeof lineItemId !== 'string' || !lineItemId) throw codedError('invalid_order', 'Order item is required.');
      return orders.removeItem({ userId, orderId, lineItemId, expectedRevision });
    },
    cancel({ userId, orderId, expectedRevision }) {
      requireRevision(expectedRevision);
      return orders.cancel({ userId, orderId, expectedRevision });
    },
  });
}

function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw codedError('invalid_order', 'A current order revision is required.');
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
