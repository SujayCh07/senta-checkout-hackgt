export function createSessionRepository(db) {
  const insert = db.prepare(`
    INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const find = db.prepare(`
    SELECT s.token_hash AS tokenHash, s.csrf_token AS csrfToken,
           s.expires_at AS expiresAt, u.id, u.email, u.created_at AS createdAt
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const expire = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return Object.freeze({
    create(session) {
      insert.run(session.tokenHash, session.userId, session.csrfToken, session.expiresAt, session.createdAt);
      return session;
    },
    findActive(tokenHash, now) { return tokenHash ? find.get(tokenHash, now) ?? null : null; },
    revoke(tokenHash) { return tokenHash ? remove.run(tokenHash).changes > 0 : false; },
    deleteExpired(now) { return expire.run(now).changes; },
  });
}
