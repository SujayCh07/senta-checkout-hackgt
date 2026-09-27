import { createSessionToken, hashSessionToken } from '../infrastructure/sessions.js';
import { hashPassword, validatePassword, verifyPassword } from '../infrastructure/passwords.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_CREDENTIAL = { algorithm: 'scrypt', salt: '00'.repeat(16), hash: '00'.repeat(64) };

export function normalizeEmail(value) {
  if (typeof value !== 'string') throw codedError('invalid_email', 'Enter a valid email address.');
  const email = value.trim().normalize('NFKC').toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw codedError('invalid_email', 'Enter a valid email address.');
  return email;
}

export function createAuthService({ users, sessions, now = Date.now, transaction = (work) => work() }) {
  if (!users || !sessions) throw new TypeError('User and session repositories are required');

  function issueSession(userId) {
    const created = createSessionToken(userId, now());
    sessions.create(created);
    return {
      rawToken: created.rawToken,
      tokenHash: created.tokenHash,
      csrfToken: created.csrfToken,
      expiresAt: created.expiresAt,
    };
  }

  return Object.freeze({
    register({ email: rawEmail, password }) {
      const email = normalizeEmail(rawEmail);
      validatePassword(password);
      const credential = hashPassword(password);
      try {
        return transaction(() => {
          if (users.findByEmail(email)) throw codedError('email_in_use', 'An account already exists for this email.');
          const user = users.create({ email, passwordSalt: credential.salt, passwordHash: credential.hash, createdAt: now() });
          const session = issueSession(user.id);
          return { user: publicUser(user), session };
        });
      } catch (error) {
        if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') throw codedError('email_in_use', 'An account already exists for this email.');
        throw error;
      }
    },

    login({ email: rawEmail, password }) {
      const email = normalizeEmail(rawEmail);
      const user = users.findByEmail(email);
      const valid = verifyPassword(password, user ? {
        algorithm: 'scrypt', salt: user.passwordSalt, hash: user.passwordHash,
      } : DUMMY_CREDENTIAL);
      if (!user || !valid) throw codedError('invalid_credentials', 'Email or password is incorrect.');
      return { user: publicUser(user), session: issueSession(user.id) };
    },

    current(rawToken) {
      const tokenHash = hashSessionToken(rawToken);
      if (!tokenHash) return null;
      const session = sessions.findActive(tokenHash, now());
      return session ? { ...publicUser(session), csrfToken: session.csrfToken } : null;
    },

    logout(rawToken) {
      const tokenHash = hashSessionToken(rawToken);
      return sessions.revoke(tokenHash);
    },
  });
}

function publicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}
