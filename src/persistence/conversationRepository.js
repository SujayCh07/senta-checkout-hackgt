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
