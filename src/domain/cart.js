export function buildCart(order) {
  const itemTotalCents = order.item.unitPriceCents * order.quantity;

  return {
    currency: 'USD',
    lineItems: [{
      itemId: order.item.id,
      name: order.item.name,
      quantity: order.quantity,
      unitPriceCents: order.item.unitPriceCents,
      totalCents: itemTotalCents,
      modifiers: { ...order.modifiers },
    }],
    subtotalCents: itemTotalCents,
    taxCents: 0,
    deliveryFeeCents: 0,
    totalCents: itemTotalCents,
    pricingNote: 'Demo catalog pricing; taxes and delivery are not calculated.',
  };
}

export function calculateOrderTotals(item, quantity, modifierIds = []) {
  if (!item || !Number.isInteger(item.priceCents) || item.priceCents < 0) {
    throw codedError('invalid_order', 'Menu item pricing is invalid.');
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw codedError('invalid_order', 'Quantity must be between 1 and 20.');
  }
  if (!Array.isArray(modifierIds) || new Set(modifierIds).size !== modifierIds.length) {
    throw codedError('invalid_order', 'Modifier selection is invalid.');
  }
  const selected = modifierIds.map((id) => item.modifiers.find((modifier) => modifier.id === id && modifier.active));
  if (selected.some((modifier) => !modifier)) throw codedError('invalid_order', 'A selected option is not available.');
  const required = item.modifiers.filter((modifier) => modifier.required);
  if (required.some((modifier) => !selected.some((choice) => choice.id === modifier.id))) {
    throw codedError('invalid_order', 'Choose all required options before checkout.');
  }
  const unitPriceCents = item.priceCents + selected.reduce((sum, modifier) => sum + modifier.priceDeltaCents, 0);
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw codedError('invalid_order', 'Calculated item price is invalid.');
  const lineTotalCents = unitPriceCents * quantity;
  return {
    currency: item.currency,
    quantity,
    unitPriceCents,
    lineTotalCents,
    subtotalCents: lineTotalCents,
    totalCents: lineTotalCents,
    modifiers: selected.map(({ id, name, priceDeltaCents }) => ({ id, name, priceDeltaCents })),
  };
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
