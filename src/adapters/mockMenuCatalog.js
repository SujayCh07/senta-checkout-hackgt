const merchants = new Map([
  ['taco-bell', {
    id: 'taco-bell',
    name: 'Taco Bell',
    items: [
      {
        id: 'crunchwrap-supreme',
        name: 'Crunchwrap Supreme',
        aliases: ['crunchwrap supreme', 'crunchwrap supremes', 'crunchwrap'],
        unitPriceCents: 599,
        requiredModifiers: ['tomatoes'],
      },
      {
        id: 'black-bean-crunchwrap-supreme',
        name: 'Black Bean Crunchwrap Supreme',
        aliases: ['black bean crunchwrap supreme', 'black bean crunchwrap', 'black bean one'],
        unitPriceCents: 599,
        requiredModifiers: ['tomatoes'],
      },
      {
        id: 'crunchwrap-supreme-combo',
        name: 'Crunchwrap Supreme Combo',
        aliases: ['crunchwrap supreme combo', 'crunchwrap combo'],
        unitPriceCents: 899,
        requiredModifiers: ['tomatoes'],
      },
    ],
  }],
]);

export function createMockMenuCatalog() {
  return {
    findMerchant(query) {
      const normalized = query.toLowerCase();
      return [...merchants.values()].find((merchant) => normalized.includes(merchant.name.toLowerCase())) ?? null;
    },

    findItem(merchantId, query) {
      const merchant = merchants.get(merchantId);
      if (!merchant) return null;
      const normalized = query.toLowerCase();
      return merchant.items
        .toSorted((a, b) => Math.max(...b.aliases.map((alias) => alias.length)) - Math.max(...a.aliases.map((alias) => alias.length)))
        .find((item) => item.aliases.some((alias) => normalized.includes(alias))) ?? null;
    },
  };
}
