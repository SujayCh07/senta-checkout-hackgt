import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';
import { createCatalogRepository } from '../src/persistence/catalogRepository.js';
import { createOrderRepository } from '../src/persistence/orderRepository.js';

test('orders are owner-scoped, integer-priced, revision-checked snapshots', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'senta-order-'));
  const db = openDatabase({ path: join(directory, 'order.sqlite') });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  runMigrations(db);
  db.prepare(`INSERT INTO users (id, email, password_salt, password_hash, created_at)
    VALUES ('owner', 'owner@example.test', 'salt', 'hash', 1), ('other', 'other@example.test', 'salt', 'hash', 1)`).run();
  const catalog = createCatalogRepository(db);
  const repository = createOrderRepository(db, { catalog, now: () => 100 });
  const item = catalog.findItem('northstar-grain-bowl');
  const order = repository.create({ userId: 'owner', conversationId: null, item, quantity: 2, modifierIds: ['grain-bowl-chicken'] });
  assert.equal(order.totalCents, 3100);
  assert.equal(order.status, 'ready');
  assert.equal(repository.findOwned(order.id, 'other'), null);

  const changed = repository.edit({ userId: 'owner', orderId: order.id, expectedRevision: 1, quantity: 3 });
  assert.equal(changed.revision, 2);
  assert.equal(changed.totalCents, 4650);
  assert.throws(() => repository.edit({ userId: 'owner', orderId: order.id, expectedRevision: 1, quantity: 1 }), { code: 'revision_conflict' });
  assert.throws(() => repository.edit({ userId: 'other', orderId: order.id, expectedRevision: 2, quantity: 1 }), { code: 'not_found' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?').get(order.id).count, 1);
});

test('cart supports multiple lines, merges identical selections, and removes lines with revision checks', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'senta-order-cart-'));
  const db = openDatabase({ path: join(directory, 'cart.sqlite') });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  runMigrations(db);
  db.prepare("INSERT INTO users (id, email, password_salt, password_hash, created_at) VALUES ('buyer', 'buyer@example.test', 'salt', 'hash', 1)").run();
  const catalog = createCatalogRepository(db);
  const orders = createOrderRepository(db, { catalog });
  const order = orders.create({ userId: 'buyer', item: catalog.findItem('northstar-grain-bowl'), quantity: 1 });
  const withSecondItem = orders.addItem({
    userId: 'buyer', orderId: order.id, expectedRevision: order.revision,
    item: catalog.findItem('crispy-chickpea-bowl'), quantity: 2,
  });
  assert.equal(withSecondItem.items.length, 2);
  assert.equal(withSecondItem.totalCents, 3450);

  const merged = orders.addItem({
    userId: 'buyer', orderId: order.id, expectedRevision: withSecondItem.revision,
    item: catalog.findItem('northstar-grain-bowl'), quantity: 2,
  });
  assert.equal(merged.items.length, 2);
  assert.deepEqual(merged.items.map((line) => line.quantity), [3, 2]);
  assert.equal(merged.totalCents, 5950);

  const reduced = orders.edit({
    userId: 'buyer', orderId: order.id, expectedRevision: merged.revision,
    lineItemId: merged.items[1].id, quantity: 1,
  });
  assert.equal(reduced.totalCents, 4850);
  const oneLine = orders.removeItem({
    userId: 'buyer', orderId: order.id, expectedRevision: reduced.revision,
    lineItemId: reduced.items[0].id,
  });
  assert.equal(oneLine.items.length, 1);
  assert.equal(oneLine.totalCents, 1100);
  const empty = orders.removeItem({
    userId: 'buyer', orderId: order.id, expectedRevision: oneLine.revision,
    lineItemId: oneLine.items[0].id,
  });
  assert.equal(empty, null);
  assert.equal(orders.findOwned(order.id, 'buyer').status, 'canceled');
});
