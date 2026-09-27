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
