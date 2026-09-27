import { randomUUID } from 'node:crypto';

export function createOrder({ merchant, item, quantity }) {
  const order = {
    id: randomUUID(),
    merchant: { id: merchant.id, name: merchant.name },
    item: {
      id: item.id,
      name: item.name,
      unitPriceCents: item.unitPriceCents,
      requiredModifiers: [...item.requiredModifiers],
    },
    quantity,
    modifiers: Object.fromEntries(item.requiredModifiers.map((key) => [key, null])),
    checkout: null,
  };
  return { ...order, status: getOrderStatus(order) };
}

export function missingRequiredModifier(order) {
  return order.item.requiredModifiers.find((key) => !order.modifiers[key]) ?? null;
}

export function getOrderStatus(order) {
  return missingRequiredModifier(order) ? 'needs_modifier' : 'ready_for_checkout';
}

export function setOrderQuantity(order, quantity) {
  const updated = { ...order, quantity, checkout: null };
  return { ...updated, status: getOrderStatus(updated) };
}

export function replaceOrderItem(order, item) {
  const updated = {
    ...order,
    item: {
      id: item.id,
      name: item.name,
      unitPriceCents: item.unitPriceCents,
      requiredModifiers: [...item.requiredModifiers],
    },
    modifiers: Object.fromEntries(item.requiredModifiers.map((key) => [key, null])),
    checkout: null,
  };
  return { ...updated, status: getOrderStatus(updated) };
}

export function setOrderModifier(order, key, value) {
  const updated = { ...order, modifiers: { ...order.modifiers, [key]: value }, checkout: null };
  return { ...updated, status: getOrderStatus(updated) };
}
