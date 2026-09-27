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

export function calculateCartTotals(lines, { maxLines = 50 } = {}) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > maxLines) {
    throw codedError('invalid_order', `A cart must contain between 1 and ${maxLines} items.`);
  }
  const currency = lines[0]?.item?.currency;
  if (!/^[A-Z]{3}$/.test(currency ?? '')) throw codedError('invalid_order', 'Cart currency is invalid.');
  const lineItems = lines.map(({ item, quantity, modifierIds = [] }) => {
    if (item.currency !== currency) throw codedError('invalid_order', 'A cart cannot mix currencies.');
    const totals = calculateOrderTotals(item, quantity, modifierIds);
    return {
      itemId: item.id,
      name: item.name,
      quantity,
      unitPriceCents: totals.unitPriceCents,
      totalCents: totals.lineTotalCents,
      modifiers: totals.modifiers,
      currency,
    };
  });
  const subtotalCents = lineItems.reduce((total, line) => total + line.totalCents, 0);
  if (!Number.isSafeInteger(subtotalCents)) throw codedError('invalid_order', 'Cart total exceeds the supported range.');
  return { currency, lineItems, subtotalCents, totalCents: subtotalCents };
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
