import { randomUUID } from 'node:crypto';

export function createMockCheckoutProvider() {
  const sessions = new Map();

  return {
    createSession(cart) {
      const id = randomUUID();
      const session = {
        id,
        url: `http://localhost:3002/checkout/${id}`,
        amountCents: cart.totalCents,
        currency: cart.currency,
        status: 'open',
        paymentStatus: 'not_paid',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
      sessions.set(id, session);
      return structuredClone(session);
    },

    getSession(id) {
      const session = sessions.get(id);
      return session ? structuredClone(session) : null;
    },

    expireSession(id) {
      const session = sessions.get(id);
      if (session?.status === 'open') {
        session.status = 'expired';
        session.paymentStatus = 'not_paid';
      }
      return session ? structuredClone(session) : null;
    },

    completeSession(id) {
      const session = sessions.get(id);
      if (!session) return null;
      if (session.status !== 'open' || new Date(session.expiresAt) <= new Date()) return null;
      session.status = 'complete';
      session.paymentStatus = 'simulated_paid';
      return structuredClone(session);
    },
  };
}
