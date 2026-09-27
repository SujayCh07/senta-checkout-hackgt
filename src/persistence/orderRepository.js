import { randomUUID } from 'node:crypto';
import { calculateOrderTotals } from '../domain/cart.js';
import { withTransaction } from '../infrastructure/database.js';

export function createOrderRepository(db, { catalog, now = Date.now } = {}) {
  if (!catalog) throw new TypeError('Catalog repository is required');
  const insertOrder = db.prepare(`
    INSERT INTO orders
      (id, user_id, conversation_id, restaurant_id, status, currency, subtotal_cents,
       total_cents, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items
      (id, order_id, menu_item_id, item_name, unit_price_cents, quantity, modifiers_json, line_total_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectOrder = db.prepare(`
    SELECT id, user_id AS userId, conversation_id AS conversationId,
           restaurant_id AS restaurantId, status, currency,
           subtotal_cents AS subtotalCents, total_cents AS totalCents,
           revision, created_at AS createdAt, updated_at AS updatedAt
    FROM orders WHERE id = ? AND user_id = ?
  `);
  const selectItem = db.prepare(`
    SELECT oi.id, oi.menu_item_id AS menuItemId, oi.item_name AS itemName,
           oi.unit_price_cents AS unitPriceCents, oi.quantity,
           oi.modifiers_json AS modifiersJson, oi.line_total_cents AS lineTotalCents
    FROM order_items oi WHERE oi.order_id = ? ORDER BY oi.rowid LIMIT 1
  `);
  const updateOrder = db.prepare(`
    UPDATE orders SET status = ?, currency = ?, subtotal_cents = ?, total_cents = ?,
      revision = revision + 1, updated_at = ?
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
    const row = selectItem.get(id);
    if (!row) throw new Error(`Order ${id} has no line item`);
    let modifiers;
    try { modifiers = JSON.parse(row.modifiersJson); } catch { throw new Error(`Order ${id} has invalid modifier state`); }
    return { ...order, item: { id: row.menuItemId, name: row.itemName }, quantity: row.quantity, unitPriceCents: row.unitPriceCents, modifiers, lineTotalCents: row.lineTotalCents };
  }

  function totalsFor(item, quantity, modifierIds) {
    return calculateOrderTotals(item, quantity, modifierIds);
  }

  function writeItem(orderId, item, totals) {
    deleteItems.run(orderId);
    insertItem.run(randomUUID(), orderId, item.id, item.name, item.priceCents, totals.quantity,
      JSON.stringify(totals.modifiers), totals.lineTotalCents);
  }

  return Object.freeze({
    create({ userId, conversationId = null, item, quantity = 1, modifierIds = [] }) {
      const totals = totalsFor(item, quantity, modifierIds);
      const id = randomUUID();
      const timestamp = now();
      const status = item.modifiers.some((modifier) => modifier.required && !totals.modifiers.some((choice) => choice.id === modifier.id)) ? 'draft' : 'ready';
      withTransaction(db, () => {
        insertOrder.run(id, userId, conversationId, item.restaurantId, status, totals.currency,
          totals.subtotalCents, totals.totalCents, timestamp, timestamp);
        writeItem(id, item, totals);
      });
      return hydrate(id, userId);
    },
    findOwned(id, userId) { return hydrate(id, userId); },
    edit({ userId, orderId, expectedRevision, quantity, modifierIds }) {
      return withTransaction(db, () => {
        const order = hydrate(orderId, userId);
        if (!order) throw codedError('not_found', 'Order was not found.');
        if (order.revision !== expectedRevision) throw codedError('revision_conflict', 'The order changed. Refresh before editing it.');
        if (!['draft', 'ready'].includes(order.status)) throw codedError('order_locked', 'This order can no longer be edited.');
        const item = catalog.findItem(order.item.id);
        if (!item) throw codedError('item_unavailable', 'This menu item is no longer available.');
        const nextQuantity = quantity ?? order.quantity;
        const nextModifierIds = modifierIds ?? order.modifiers.map((modifier) => modifier.id);
        const totals = totalsFor(item, nextQuantity, nextModifierIds);
        const status = item.modifiers.some((modifier) => modifier.required && !totals.modifiers.some((choice) => choice.id === modifier.id)) ? 'draft' : 'ready';
        const updatedAt = Math.max(now(), order.updatedAt + 1);
        const changed = updateOrder.run(status, totals.currency, totals.subtotalCents, totals.totalCents,
          updatedAt, orderId, userId, expectedRevision).changes;
        if (changed !== 1) throw codedError('revision_conflict', 'The order changed. Refresh before editing it.');
        writeItem(orderId, item, totals);
        return hydrate(orderId, userId);
      });
    },
    cancel({ userId, orderId, expectedRevision }) {
      return withTransaction(db, () => {
        const order = hydrate(orderId, userId);
        if (!order) throw codedError('not_found', 'Order was not found.');
        if (order.revision !== expectedRevision) throw codedError('revision_conflict', 'The order changed. Refresh before canceling it.');
        const changed = cancelOrder.run(Math.max(now(), order.updatedAt + 1), orderId, userId, expectedRevision).changes;
        if (!changed) throw codedError('revision_conflict', 'The order changed. Refresh before canceling it.');
        return hydrate(orderId, userId);
      });
    },
  });
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
