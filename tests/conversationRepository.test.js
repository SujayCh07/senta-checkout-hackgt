import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';
import { createConversationRepository } from '../src/persistence/conversationRepository.js';

test('conversation reads enforce ownership and append turns atomically in sequence', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'senta-conversation-'));
  const db = openDatabase({ path: join(directory, 'conversation.sqlite') });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  runMigrations(db);
  const now = 10;
  db.prepare(`INSERT INTO users (id, email, password_salt, password_hash, created_at)
    VALUES ('owner', 'owner@example.test', 'salt', 'hash', 1), ('other', 'other@example.test', 'salt', 'hash', 1)`).run();
  const repository = createConversationRepository(db, { now: () => now });
  const created = repository.create({ id: 'conversation-1', userId: 'owner', state: { order: null } });

  assert.equal(repository.findOwned('conversation-1', 'other'), null);
  assert.deepEqual(created.messages, []);
  const updated = repository.appendTurn({
    id: created.id,
    userId: 'owner',
    expectedUpdatedAt: created.updatedAt,
    userText: 'Build a grain bowl',
    assistantText: 'Which bowl would you like?',
    state: { order: { itemId: 'northstar-grain-bowl' } },
  });
  assert.equal(updated.messages.length, 2);
  assert.deepEqual(updated.messages.map((message) => message.sequence), [1, 2]);
  assert.equal(repository.findOwned('conversation-1', 'owner').state.order.itemId, 'northstar-grain-bowl');
  assert.throws(() => repository.appendTurn({
    id: created.id, userId: 'owner', expectedUpdatedAt: created.updatedAt,
    userText: 'stale write', assistantText: 'ignored', state: {},
  }), { code: 'revision_conflict' });
  assert.equal(repository.findOwned('conversation-1', 'owner').messages.length, 2);
});
