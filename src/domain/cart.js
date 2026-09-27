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
