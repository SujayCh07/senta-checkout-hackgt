const numberWords = new Map([
  ['a', 1], ['an', 1], ['one', 1], ['two', 2], ['three', 3],
  ['four', 4], ['five', 5], ['six', 6],
]);

function quantityFrom(text) {
  const match = text.toLowerCase().match(/\b(\d+|one|two|three|four|five|six|a|an)\b/);
  return match ? Number(match[1]) || numberWords.get(match[1]) : null;
}

export function parseFoodIntent(text, order = null) {
  const normalized = text.trim().toLowerCase();

  if (/\b(forget|cancel|clear)\b.*\b(order|that|it)?\b/.test(normalized) || normalized === 'cancel') {
    return { type: 'cancel' };
  }

  if (/\b(check ?out|pay|place (the )?order)\b/.test(normalized)) {
    return { type: 'checkout' };
  }

  const quantity = quantityFrom(normalized);
  if (order && quantity !== null && /\b(make it|change (it )?to|set (it )?to|quantity)\b/.test(normalized)) {
    return { type: 'set_quantity', quantity };
  }

  const modifierMatch = normalized.match(/\b(no|extra|light|regular)\s+tomatoes\b/);
  if (modifierMatch) {
    const tomatoChoice = modifierMatch[1] === 'no' ? 'none' : modifierMatch[1] === 'extra' ? 'extra' : 'standard';
    return { type: 'set_modifier', key: 'tomatoes', value: tomatoChoice };
  }

  if (order && /\b(black bean|crunchwrap)\b/.test(normalized)) {
    return { type: 'replace_item', query: normalized };
  }

  if (!order) {
    return { type: 'start_order', query: normalized, quantity: quantity ?? 1 };
  }

  return { type: 'unknown' };
}
