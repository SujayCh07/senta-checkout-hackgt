import { readRawBody } from '../body.js';
import { sendError, sendJson } from '../responses.js';

export function createStripeWebhookRoute({ webhookService }) {
  return async function handleStripeWebhook(request, response, url) {
    if (request.method !== 'POST' || url.pathname !== '/api/webhooks/stripe') return false;
    if (!webhookService) {
      sendJson(response, 503, { error: 'Stripe webhooks are not configured.', code: 'payment_unavailable' });
      return true;
    }
    try {
      const rawBody = await readRawBody(request);
      const result = webhookService.receive(rawBody, request.headers['stripe-signature']);
      sendJson(response, 200, result);
    } catch (error) {
      sendError(response, error);
    }
    return true;
  };
}
