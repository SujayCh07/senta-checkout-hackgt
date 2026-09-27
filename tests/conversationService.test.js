import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentConversationService } from '../src/application/persistentConversationService.js';
import { openDatabase } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';
import { createCatalogRepository } from '../src/persistence/catalogRepository.js';
import { createConversationRepository } from '../src/persistence/conversationRepository.js';
import { createOrderRepository } from '../src/persistence/orderRepository.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'senta-service-'));
  const db = openDatabase({ path: join(directory, 'app.sqlite') });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  runMigrations(db);
  db.prepare(`INSERT INTO users (id, email, password_salt, password_hash, created_at)
    VALUES ('owner', 'owner@example.test', 'salt', 'hash', 1), ('other', 'other@example.test', 'salt', 'hash', 1)`).run();
  const catalog = createCatalogRepository(db);
  const conversations = createConversationRepository(db);
  const orders = createOrderRepository(db, { catalog });
  return { db, service: createPersistentConversationService({ conversations, orders, catalog }) };
}

test('authenticated conversation turns persist messages and catalog-priced orders', async (t) => {
  const { db, service } = await fixture(t);
  const conversation = service.createConversation('owner');
  const result = service.sendMessage({ userId: 'owner', conversationId: conversation.id, text: 'Get two Northstar Grain Bowls from Northstar Kitchen' });
  assert.equal(result.order.quantity, 2);
  assert.equal(result.order.totalCents, 2500);
  assert.equal(result.cart.lineItems[0].name, 'Northstar Grain Bowl');
  assert.equal(result.conversation.messages.length, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders WHERE user_id = ?').get('owner').count, 1);

  const reloaded = createPersistentConversationService({
    conversations: createConversationRepository(db),
    orders: createOrderRepository(db, { catalog: createCatalogRepository(db) }),
    catalog: createCatalogRepository(db),
  });
  assert.equal(reloaded.getConversation('owner', conversation.id).order.totalCents, 2500);
  assert.throws(() => reloaded.getConversation('other', conversation.id), { code: 'not_found' });
  assert.throws(() => reloaded.sendMessage({ userId: 'other', conversationId: conversation.id, text: 'checkout' }), { code: 'not_found' });
});

test('order creation and message persistence roll back together on a failed turn', async (t) => {
  const { db } = await fixture(t);
  const catalog = createCatalogRepository(db);
  const conversationRepo = createConversationRepository(db);
  const created = conversationRepo.create({ userId: 'owner', state: { orderId: null } });
  assert.throws(() => conversationRepo.appendTurn({
    id: created.id, userId: 'owner', expectedUpdatedAt: created.updatedAt,
    userText: 'hello', assistantText: 'hi', state: { orderId: 'never' },
    persist: () => { db.prepare(`INSERT INTO orders
      (id, user_id, restaurant_id, status, currency, subtotal_cents, total_cents, revision, created_at, updated_at)
      VALUES ('partial', 'owner', 'northstar-kitchen', 'ready', 'USD', 100, 100, 1, 1, 1)`).run(); throw new Error('fail after order write'); },
  }), /fail after order write/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE id = 'partial'").get().count, 0);
  assert.equal(conversationRepo.findOwned(created.id, 'owner').messages.length, 0);
  assert.ok(catalog.findItem('northstar-grain-bowl'));
});

test('conversation can add a second catalog item and return an itemized cart total', async (t) => {
  const { service } = await fixture(t);
  const conversation = service.createConversation('owner');
  service.sendMessage({ userId: 'owner', conversationId: conversation.id, text: 'Get one Northstar Grain Bowl' });
  const result = service.sendMessage({ userId: 'owner', conversationId: conversation.id, text: 'Add two Crispy Chickpea Bowls' });
  assert.equal(result.order.items.length, 2);
  assert.deepEqual(result.order.items.map((line) => line.quantity), [1, 2]);
  assert.equal(result.cart.lineItems.length, 2);
  assert.equal(result.cart.totalCents, 3450);
});
