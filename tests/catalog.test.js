import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.js';
import { runMigrations } from '../src/infrastructure/migrate.js';
import { createCatalogRepository } from '../src/persistence/catalogRepository.js';

test('catalog migrations seed active restaurants, integer-cent items, and modifiers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'senta-catalog-'));
  const db = openDatabase({ path: join(directory, 'catalog.sqlite') });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  runMigrations(db);
  const catalog = createCatalogRepository(db);
  const restaurants = catalog.listActive();
  assert.equal(restaurants.length, 1);
  assert.equal(restaurants[0].name, 'Northstar Kitchen');
  assert.equal(restaurants[0].items.length, 3);
  assert.equal(restaurants[0].items[0].currency, 'USD');
  assert.ok(Number.isInteger(restaurants[0].items[0].priceCents));
  assert.equal(catalog.findItem('missing-item'), null);
  assert.equal(catalog.findItemByName('Crispy Chickpea Bowl').priceCents, 1100);
});
