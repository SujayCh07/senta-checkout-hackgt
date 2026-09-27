import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase, withTransaction } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';

async function makeDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), 'senta-checkout-db-'));
  const path = join(directory, 'checkout.sqlite');
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return { path, db: openDatabase({ path, busyTimeoutMs: 1000 }) };
}

test('migrations are ordered and idempotent', async (t) => {
  const { db } = await makeDatabase(t);
  t.after(() => db.close());

  const first = runMigrations(db);
  const second = runMigrations(db);

  assert.ok(first.applied.includes('001_initial_schema'));
  assert.deepEqual(second.applied, []);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

test('foreign keys and integer-cent catalog constraints reject invalid rows', async (t) => {
  const { db } = await makeDatabase(t);
  t.after(() => db.close());
  runMigrations(db);

  assert.throws(() => db.prepare(`
    INSERT INTO conversations (id, user_id, created_at, updated_at)
    VALUES ('orphan', 'missing-user', 1, 1)
  `).run());

  db.prepare(`
    INSERT INTO restaurants (id, slug, name, active, created_at)
    VALUES ('restaurant-1', 'northstar', 'Northstar Kitchen', 1, 1)
  `).run();
  assert.throws(() => db.prepare(`
    INSERT INTO menu_items
      (id, restaurant_id, name, price_cents, currency, active, catalog_version)
    VALUES ('item-fraction', 'restaurant-1', 'Noodle Bowl', 12.5, 'USD', 1, 1)
  `).run());
});

test('file-backed database retains rows after close and reopen', async (t) => {
  const { path, db } = await makeDatabase(t);
  runMigrations(db);
  withTransaction(db, () => {
    db.prepare(`
      INSERT INTO users (id, email, password_salt, password_hash, created_at)
      VALUES ('user-1', 'person@example.test', 'salt', 'hash', 10)
    `).run();
  });
  db.close();

  const reopened = openDatabase({ path, busyTimeoutMs: 1000 });
  try {
    assert.deepEqual(
      { ...reopened.prepare('SELECT id, email FROM users').get() },
      { id: 'user-1', email: 'person@example.test' },
    );
  } finally {
    reopened.close();
  }
});

test('transaction helper rolls back all writes when its callback throws', async (t) => {
  const { db } = await makeDatabase(t);
  t.after(() => db.close());
  runMigrations(db);

  assert.throws(() => withTransaction(db, () => {
    db.prepare(`
      INSERT INTO users (id, email, password_salt, password_hash, created_at)
      VALUES ('user-rollback', 'rollback@example.test', 'salt', 'hash', 11)
    `).run();
    throw new Error('abort transaction');
  }), /abort transaction/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});
