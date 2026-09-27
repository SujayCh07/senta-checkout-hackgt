import { randomUUID } from 'node:crypto';
import { withTransaction } from '../infrastructure/database.js';

export function createConversationRepository(db, { now = Date.now } = {}) {
  const insertConversation = db.prepare(`
    INSERT INTO conversations (id, user_id, state_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const getConversation = db.prepare(`
    SELECT id, user_id AS userId, state_json AS stateJson,
           created_at AS createdAt, updated_at AS updatedAt
    FROM conversations WHERE id = ? AND user_id = ?
  `);
  const getMessages = db.prepare(`
    SELECT id, role, content AS text, created_at AS createdAt, sequence
    FROM messages WHERE conversation_id = ? ORDER BY sequence
  `);
  const lastSequence = db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM messages WHERE conversation_id = ?');
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, created_at, sequence)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateConversation = db.prepare(`
    UPDATE conversations SET state_json = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND updated_at = ?
  `);
  const listConversations = db.prepare(`
    SELECT c.id, c.created_at AS createdAt, c.updated_at AS updatedAt,
           c.state_json AS stateJson,
           (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY sequence DESC LIMIT 1) AS latestMessage
    FROM conversations c
    WHERE c.user_id = ?
      AND (? IS NULL OR c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT ?
  `);

  function hydrate(row) {
    if (!row) return null;
    let state;
    try { state = JSON.parse(row.stateJson); } catch { throw new Error(`Conversation ${row.id} has invalid stored state`); }
    return { ...row, state, messages: getMessages.all(row.id) };
  }

  return Object.freeze({
    create({ id = randomUUID(), userId, state = {}, initialMessage = null }) {
      const createdAt = now();
      withTransaction(db, () => {
        insertConversation.run(id, userId, JSON.stringify(state), createdAt, createdAt);
        if (initialMessage) insertMessage.run(randomUUID(), id, 'assistant', initialMessage, createdAt, 1);
      });
      return hydrate(getConversation.get(id, userId));
    },
    findOwned(id, userId) { return hydrate(getConversation.get(id, userId)); },
    listOwned(userId, { limit = 20, cursor = null } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw codedError('invalid_pagination', 'History limit must be between 1 and 100.');
      const position = cursor ? decodeCursor(cursor) : null;
      const rows = listConversations.all(userId, position?.updatedAt ?? null, position?.updatedAt ?? null,
        position?.updatedAt ?? null, position?.id ?? null, limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map((row) => {
        let state;
        try { state = JSON.parse(row.stateJson); } catch { throw new Error(`Conversation ${row.id} has invalid stored state`); }
        return { id: row.id, state, createdAt: row.createdAt, updatedAt: row.updatedAt, latestMessage: row.latestMessage ?? '' };
      });
      const last = page.at(-1);
      return { items: page, hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null };
    },
    appendTurn({ id, userId, expectedUpdatedAt, userText, assistantText, state, persist = () => {} }) {
      return withTransaction(db, () => {
        const current = getConversation.get(id, userId);
        if (!current) throw codedError('not_found', 'Conversation was not found.');
        if (current.updatedAt !== expectedUpdatedAt) throw codedError('revision_conflict', 'Conversation changed. Reload it and try again.');
        const createdAt = Math.max(now(), current.updatedAt + 1);
        const firstSequence = lastSequence.get(id).sequence + 1;
        const persistenceResult = persist();
        if (persistenceResult && typeof persistenceResult.then === 'function') throw new TypeError('Conversation turn persistence must be synchronous');
        const changed = updateConversation.run(JSON.stringify(state), createdAt, id, userId, expectedUpdatedAt).changes;
        if (changed !== 1) throw codedError('revision_conflict', 'Conversation changed. Reload it and try again.');
        insertMessage.run(randomUUID(), id, 'user', userText, createdAt, firstSequence);
        insertMessage.run(randomUUID(), id, 'assistant', assistantText, createdAt, firstSequence + 1);
        return hydrate(getConversation.get(id, userId));
      });
    },
  });
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ updatedAt: row.updatedAt, id: row.id }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(cursor.updatedAt) || typeof cursor.id !== 'string' || !cursor.id) throw new Error('invalid');
    return cursor;
  } catch {
    throw codedError('invalid_cursor', 'Conversation history cursor is invalid.');
  }
}
