import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const activeTransactions = new WeakSet();

export function openDatabase({ path, busyTimeoutMs = 5000 } = {}) {
  if (!path || typeof path !== 'string') {
    throw new TypeError('A database path is required');
  }
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 1) {
    throw new TypeError('busyTimeoutMs must be a positive integer');
  }

  const filename = path === ':memory:' ? path : resolve(path);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: busyTimeoutMs });
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeoutMs};`);
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

export function withTransaction(db, work) {
  if (!db || typeof db.exec !== 'function' || typeof work !== 'function') {
    throw new TypeError('withTransaction requires a database and callback');
  }
  if (work.constructor?.name === 'AsyncFunction') {
    throw new TypeError('SQLite transaction callbacks must be synchronous');
  }
  if (activeTransactions.has(db)) return work();
  db.exec('BEGIN IMMEDIATE');
  activeTransactions.add(db);
  try {
    const result = work();
    if (result && typeof result.then === 'function') {
      throw new TypeError('SQLite transaction callbacks must be synchronous');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    activeTransactions.delete(db);
  }
}
