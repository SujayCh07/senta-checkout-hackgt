import { randomUUID } from 'node:crypto';

export function createUserRepository(db) {
  const insert = db.prepare(`
    INSERT INTO users (id, email, password_salt, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const byEmail = db.prepare(`
    SELECT id, email, password_salt AS passwordSalt, password_hash AS passwordHash, created_at AS createdAt
    FROM users WHERE email = ? COLLATE NOCASE
  `);
  const byId = db.prepare('SELECT id, email, created_at AS createdAt FROM users WHERE id = ?');

  return Object.freeze({
    create({ email, passwordSalt, passwordHash, createdAt }) {
      const id = randomUUID();
      insert.run(id, email, passwordSalt, passwordHash, createdAt);
      return byId.get(id);
    },
    findByEmail(email) { return byEmail.get(email) ?? null; },
    findById(id) { return byId.get(id) ?? null; },
  });
}
