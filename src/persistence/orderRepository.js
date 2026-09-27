import { randomUUID } from 'node:crypto';
import { calculateCartTotals } from '../domain/cart.js';
import { withTransaction } from '../infrastructure/database.js';

const MAX_CART_LINES = 50;

export function createOrderRepository(db, { catalog, now = Date.now } = {}) {
  if (!catalog) throw new TypeError('Catalog repository is required');
  const insertOrder = db.prepare(`
    INSERT INTO orders (id, user_id, conversation_id, restaurant_id, status, currency, subtotal_cents, total_cents, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (id, order_id, menu_item_id, item_name, unit_price_cents, quantity, modifiers_json, line_total_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectOrder = db.prepare(`
    SELECT id, user_id AS userId, conversation_id AS conversationId, restaurant_id AS restaurantId,
      status, currency, subtotal_cents AS subtotalCents, total_cents AS totalCents,
      revision, created_at AS createdAt, updated_at AS updatedAt
    FROM orders WHERE id = ? AND user_id = ?
  `);
  const selectItems = db.prepare(`
    SELECT id, menu_item_id AS menuItemId, item_name AS itemName, unit_price_cents AS unitPriceCents,
      quantity, modifiers_json AS modifiersJson, line_total_cents AS lineTotalCents
    FROM order_items WHERE order_id = ? ORDER BY rowid
  `);
  const updateOrder = db.prepare(`
    UPDATE orders SET status = ?, currency = ?, subtotal_cents = ?, total_cents = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND user_id = ? AND revision = ? AND status IN ('draft', 'ready')
  `);
  const deleteItems = db.prepare('DELETE FROM order_items WHERE order_id = ?');
  const cancelOrder = db.prepare(`
    UPDATE orders SET status = 'canceled', revision = revision + 1, updated_at = ?
    WHERE id = ? AND user_id = ? AND revision = ? AND status IN ('draft', 'ready')
  `);

  function hydrate(id, userId) {
    const order = selectOrder.get(id, userId);
    if (!order) return null;
    const rows = selectItems.all(id);
    if (rows.length === 0) throw new Error(`Order ${id} has no line items`);
    const items = rows.map((row) => {
      let modifiers;
      try { modifiers = JSON.parse(row.modifiersJson); } catch { throw new Error(`Order ${id} has invalid modifier state`); }
      return { id: row.id, menuItemId: row.menuItemId, item: { id: row.menuItemId, name: row.itemName },
        quantity: row.quantity, unitPriceCents: row.unitPriceCents, modifiers, lineTotalCents: row.lineTotalCents };
    });
    const first = items[0];
    return { ...order, items, item: first.item, quantity: first.quantity, unitPriceCents: first.unitPriceCents,
      modifiers: first.modifiers, lineTotalCents: items.reduce((sum, line) => sum + line.lineTotalCents, 0) };
  }

  function normalizeLines(lines) {
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_CART_LINES) {
      throw codedError('invalid_order', `A cart must contain between 1 and ${MAX_CART_LINES} items.`);
    }
    const catalogLines = lines.map((line) => {
      const item = line.item?.modifiers ? line.item : catalog.findItem(line.itemId ?? line.item?.id);
      if (!item) throw codedError('item_unavailable', 'A menu item is no longer available.');
      return { item, quantity: line.quantity, modifierIds: line.modifierIds ?? [] };
    });
    if (new Set(catalogLines.map(({ item }) => item.restaurantId)).size !== 1) {
      throw codedError('invalid_order', 'One order can contain items from only one restaurant.');
    }
    return { catalogLines, totals: calculateCartTotals(catalogLines, { maxLines: MAX_CART_LINES }) };
  }

  function writeItems(orderId, catalogLines, totals) {
    deleteItems.run(orderId);
    catalogLines.forEach(({ item }, index) => {
      const line = totals.lineItems[index];
      insertItem.run(randomUUID(), orderId, item.id, item.name, line.unitPriceCents, line.quantity,
        JSON.stringify(line.modifiers), line.totalCents);
    });
  }

  function currentLines(order) {
    return order.items.map((line) => ({ item: catalog.findItem(line.menuItemId), quantity: line.quantity,
      modifierIds: line.modifiers.map((modifier) => modifier.id) }));
  }

  function updateSnapshot({ userId, orderId, expectedRevision, lines }) {
    const order = hydrate(orderId, userId);
    if (!order) throw codedError('not_found', 'Order was not found.');
    if (order.revision !== expectedRevision) throw codedError('revision_conflict', 'The order changed. Refresh before editing it.');
    if (!['draft', 'ready'].includes(order.status)) throw codedError('order_locked', 'This order can no longer be edited.');
    const { catalogLines, totals } = normalizeLines(lines);
    const timestamp = Math.max(now(), order.updatedAt + 1);
    const changes = updateOrder.run('ready', totals.currency, totals.subtotalCents, totals.totalCents,
      timestamp, orderId, userId, expectedRevision).changes;
    if (changes !== 1) throw codedError('revision_conflict', 'The order changed. Refresh before editing it.');
    writeItems(orderId, catalogLines, totals);
    return hydrate(orderId, userId);
  }

  return Object.freeze({
    create({ userId, conversationId = null, item, quantity = 1, modifierIds = [], lines = null }) {
      const { catalogLines, totals } = normalizeLines(lines ?? [{ item, quantity, modifierIds }]);
      const id = randomUUID();
      const timestamp = now();
      withTransaction(db, () => {
        insertOrder.run(id, userId, conversationId, catalogLines[0].item.restaurantId, 'ready', totals.currency,
          totals.subtotalCents, totals.totalCents, timestamp, timestamp);
        writeItems(id, catalogLines, totals);
      });
      return hydrate(id, userId);
    },
    findOwned(id, userId) { return hydrate(id, userId); },
    edit({ userId, orderId, expectedRevision, lineItemId, quantity, modifierIds }) {
      return withTransaction(db, () => {
        const order = hydrate(orderId, userId);
        if (!order) throw codedError('not_found', 'Order was not found.');
        const index = lineItemId ? order.items.findIndex((line) => line.id === lineItemId) : 0;
        if (index < 0) throw codedError('not_found', 'Order item was not found.');
        const lines = currentLines(order);
        if (quantity !== undefined) lines[index].quantity = quantity;
        if (modifierIds !== undefined) lines[index].modifierIds = modifierIds;
        return updateSnapshot({ userId, orderId, expectedRevision, lines });
      });
    },
    addItem({ userId, orderId, expectedRevision, item, quantity = 1, modifierIds = [] }) {
      return withTransaction(db, () => {
        const order = hydrate(orderId, userId);
        if (!order) throw codedError('not_found', 'Order was not found.');
        if (order.revision !== expectedRevision) throw codedError('revision_conflict', 'The order changed. Refresh before editing it.');
        if (!['draft', 'ready'].includes(order.status)) throw codedError('order_locked', 'This order can no longer be edited.');
        const lines = currentLines(order);
        const signature = [...modifierIds].sort().join(',');
        const current = lines.find((line) => line.item.id === item.id && [...line.modifierIds].sort().join(',') === signature);
        if (current) current.quantity += quantity;
        else lines.push({ item, quantity, modifierIds });
        return updateSnapshot({ userId, orderId, expectedRevision, lines });
      });
    },
    removeItem({ userId, orderId, expectedRevision, lineItemId }) {
      return withTransaction(db, () => {
        const order = hydrate(orderId, userId);
        if (!order) throw codedError('not_found', 'Order was not found.');
        if (order.revision !== expectedRevision) throw codedError('revision_conflict', 'The order changed. Refresh before editing it.');
        const index = order.items.findIndex((line) => line.id === lineItemId);
        if (index < 0) throw codedError('not_found', 'Order item was not found.');
        const lines = currentLines(order);
        lines.splice(index, 1);
        if (lines.length === 0) {
          const changed = cancelOrder.run(Math.max(now(), order.updatedAt + 1), orderId, userId, expectedRevision).changes;
          if (!changed) throw codedError('revision_conflict', 'The order changed. Refresh before editing it.');
          return null;
        }
        return updateSnapshot({ userId, orderId, expectedRevision, lines });
      });
    },
    cancel({ userId, orderId, expectedRevision }) {
      return withTransaction(db, () => {
        const order = hydrate(orderId, userId);
        if (!order) throw codedError('not_found', 'Order was not found.');
        if (order.revision !== expectedRevision) throw codedError('revision_conflict', 'The order changed. Refresh before canceling it.');
        const changes = cancelOrder.run(Math.max(now(), order.updatedAt + 1), orderId, userId, expectedRevision).changes;
        if (!changes) throw codedError('revision_conflict', 'The order changed. Refresh before canceling it.');
        return { ...order, status: 'canceled', revision: order.revision + 1 };
      });
    },
  });
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
