const NUMBER_WORDS = new Map([
  ['a', 1], ['an', 1], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11],
  ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15], ['sixteen', 16],
  ['seventeen', 17], ['eighteen', 18], ['nineteen', 19], ['twenty', 20],
]);

export function parseCatalogIntent(text, currentOrder = null, restaurants = []) {
  if (typeof text !== 'string' || !text.trim()) return { type: 'unknown' };
  const normalized = normalize(text);
  if (/\b(cancel|clear|discard)\b/.test(normalized)) return { type: 'cancel' };
  if (/\b(check\s*out|checkout|pay|payment)\b/.test(normalized)) return { type: 'checkout' };

  const quantity = readQuantity(normalized);
  if (currentOrder && quantity !== null && /\b(make it|change to|set to|quantity|update quantity)\b/.test(normalized)) {
    return quantity >= 1 && quantity <= 20 ? { type: 'set_quantity', quantity } : { type: 'invalid_quantity', quantity };
  }

  if (currentOrder?.itemId) {
    const currentItem = findItem(restaurants, currentOrder.itemId);
    const modifierAction = parseModifier(normalized, currentItem, currentOrder.modifierIds ?? []);
    if (modifierAction) return modifierAction;
  }

  const match = findMentionedItem(normalized, restaurants);
  if (match) return { type: 'start_order', itemId: match.id, quantity: quantity ?? 1 };
  return { type: 'unknown' };
}

function parseModifier(text, item, selectedIds) {
  if (!item?.modifiers?.length) return null;
  const modifier = [...item.modifiers]
    .sort((left, right) => right.name.length - left.name.length)
    .find((option) => includesPhrase(text, normalize(option.name)));
  if (!modifier) return null;
  const selected = new Set(selectedIds);
  if (/\b(no|remove|without|skip)\b/.test(text)) selected.delete(modifier.id);
  else if (/\b(add|with|include|extra)\b/.test(text)) selected.add(modifier.id);
  else return null;
  return { type: 'set_modifiers', modifierIds: [...selected] };
}

function findMentionedItem(text, restaurants) {
  const items = restaurants.flatMap((restaurant) => restaurant.items ?? []);
  return items.sort((left, right) => right.name.length - left.name.length)
    .find((item) => includesPhrase(text, normalize(item.name))) ?? null;
}

function findItem(restaurants, id) {
  return restaurants.flatMap((restaurant) => restaurant.items ?? []).find((item) => item.id === id) ?? null;
}

function includesPhrase(text, phrase) {
  return text.includes(phrase) || text.includes(`${phrase}s`) || text.includes(`${phrase}es`);
}

function normalize(text) {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function readQuantity(text) {
  const wordPattern = [...NUMBER_WORDS.keys()].sort((a, b) => b.length - a.length).join('|');
  const match = text.match(new RegExp(`\\b(\\d+|${wordPattern})\\b`));
  if (!match) return null;
  return Number(match[1]) || NUMBER_WORDS.get(match[1]) || null;
}
