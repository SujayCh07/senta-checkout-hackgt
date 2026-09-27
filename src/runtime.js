import { createAuthService } from './application/authService.js';
import { loadConfig } from './config.js';
import { openDatabase, withTransaction } from './infrastructure/database.js';
import { runMigrations } from './infrastructure/migrate.js';
import { createCatalogRepository } from './persistence/catalogRepository.js';
import { createConversationRepository } from './persistence/conversationRepository.js';
import { createOrderRepository } from './persistence/orderRepository.js';
import { createSessionRepository } from './persistence/sessionRepository.js';
import { createUserRepository } from './persistence/userRepository.js';
import { createAuthRoutes } from './http/routes/authRoutes.js';
import { createPersistentConversationService } from './application/persistentConversationService.js';
import { createCheckoutService } from './application/checkoutService.js';
import { createPaymentWebhookService } from './application/paymentWebhookService.js';
import { createPaymentRepository } from './persistence/paymentRepository.js';
import { createStripeCheckoutProvider } from './providers/stripeCheckoutProvider.js';
import { createStripeWebhookVerifier } from './providers/stripeWebhookVerifier.js';
import { createStripeWebhookRoute } from './http/routes/stripeWebhookRoute.js';
import { createOrderService } from './application/orderService.js';
import { assertSupportedNodeVersion } from './infrastructure/runtimeVersion.js';

export function createRuntime({ config = loadConfig(), databasePath, now = Date.now } = {}) {
  assertSupportedNodeVersion();
  const db = openDatabase({ path: databasePath || config.databasePath, busyTimeoutMs: config.busyTimeoutMs });
  try {
    const migrations = runMigrations(db);
    const users = createUserRepository(db);
    const sessions = createSessionRepository(db);
    sessions.deleteExpired(now());
    const authService = createAuthService({ users, sessions, now, transaction: (work) => withTransaction(db, work) });
    const catalog = createCatalogRepository(db);
    const conversations = createConversationRepository(db, { now });
    const orders = createOrderRepository(db, { catalog, now });
    const orderService = createOrderService({ orders, catalog });
    const payments = createPaymentRepository(db, { now });
    const hasTestStripe = config.stripeSecretKey.startsWith('sk_test_') && config.stripeWebhookSecret.startsWith('whsec_');
    const provider = hasTestStripe ? createStripeCheckoutProvider({
      secretKey: config.stripeSecretKey,
      successUrl: `${config.publicOrigin}/checkout/success`,
      cancelUrl: `${config.publicOrigin}/checkout/cancel`,
    }) : null;
    const checkoutService = provider ? createCheckoutService({ orders, payments, provider, catalog }) : null;
    const webhookVerifier = hasTestStripe ? createStripeWebhookVerifier({ secret: config.stripeWebhookSecret }) : null;
    const webhookService = webhookVerifier ? createPaymentWebhookService({ verifier: webhookVerifier, payments }) : null;
    const stripeWebhookRoute = createStripeWebhookRoute({ webhookService });
    const conversationService = createPersistentConversationService({ conversations, orders, catalog });
    const authRoutes = createAuthRoutes({
      authService,
      cookieName: config.sessionCookieName,
      secureCookies: config.isProduction,
      expectedOrigin: config.publicOrigin,
    });
    return Object.freeze({ config, db, authService, authRoutes, catalog, conversations, orders, orderService, payments, checkoutService, stripeWebhookRoute, conversationService, migrations, close: () => db.close() });
  } catch (error) {
    db.close();
    throw error;
  }
}
