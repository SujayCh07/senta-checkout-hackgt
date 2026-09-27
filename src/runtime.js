import { createAuthService } from './application/authService.js';
import { loadConfig } from './config.js';
import { openDatabase } from './infrastructure/database.js';
import { runMigrations } from './infrastructure/migrate.js';
import { createCatalogRepository } from './persistence/catalogRepository.js';
import { createConversationRepository } from './persistence/conversationRepository.js';
import { createOrderRepository } from './persistence/orderRepository.js';
import { createSessionRepository } from './persistence/sessionRepository.js';
import { createUserRepository } from './persistence/userRepository.js';
import { createAuthRoutes } from './http/routes/authRoutes.js';
import { createPersistentConversationService } from './application/persistentConversationService.js';

export function createRuntime({ config = loadConfig(), databasePath, now = Date.now } = {}) {
  const db = openDatabase({ path: databasePath || config.databasePath, busyTimeoutMs: config.busyTimeoutMs });
  try {
    const migrations = runMigrations(db);
    const users = createUserRepository(db);
    const sessions = createSessionRepository(db);
    const authService = createAuthService({ users, sessions, now });
    const catalog = createCatalogRepository(db);
    const conversations = createConversationRepository(db, { now });
    const orders = createOrderRepository(db, { catalog, now });
    const conversationService = createPersistentConversationService({ conversations, orders, catalog });
    const authRoutes = createAuthRoutes({
      authService,
      cookieName: config.sessionCookieName,
      secureCookies: config.isProduction,
    });
    return Object.freeze({ db, authService, authRoutes, catalog, conversations, orders, conversationService, migrations, close: () => db.close() });
  } catch (error) {
    db.close();
    throw error;
  }
}
