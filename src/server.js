import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConversationService } from './application/conversationService.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDirectory = resolve(here, '../public');
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);
const MAX_BODY_BYTES = 16 * 1024;

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function sendStatic(response, pathname) {
  const requestedPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const allowedFiles = new Set(['index.html', 'app.js', 'styles.css', 'checkout.html', 'checkout.js']);
  if (!allowedFiles.has(requestedPath)) {
    response.writeHead(404).end('Not found');
    return;
  }
  const fullPath = resolve(publicDirectory, requestedPath);

  try {
    const content = await readFile(fullPath);
    response.writeHead(200, { 'content-type': contentTypes.get(extname(fullPath)) ?? 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

export function createSentaDemoServer({ service = createConversationService() } = {}) {
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');

    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok', mode: 'local-demo' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/conversations') {
      const conversation = service.createConversation();
      sendJson(response, 201, conversation);
      return;
    }

    const checkoutPage = url.pathname.match(/^\/checkout\/([a-f0-9-]+)$/i);
    if (request.method === 'GET' && checkoutPage) {
      await sendStatic(response, '/checkout.html');
      return;
    }

    const checkoutSession = url.pathname.match(/^\/api\/mock-checkout\/([a-f0-9-]+)$/i);
    if (request.method === 'GET' && checkoutSession) {
      const session = service.getCheckout(checkoutSession[1]);
      sendJson(response, session ? 200 : 404, session ?? { error: 'Checkout session was not found.' });
      return;
    }

    const completeSession = url.pathname.match(/^\/api\/mock-checkout\/([a-f0-9-]+)\/complete$/i);
    if (request.method === 'POST' && completeSession) {
      const current = service.getCheckout(completeSession[1]);
      if (!current) {
        sendJson(response, 404, { error: 'Checkout session was not found.' });
        return;
      }
      const completed = service.completeCheckout(completeSession[1]);
      sendJson(response, completed ? 200 : 409, completed ?? { error: 'Checkout is expired or already complete.' });
      return;
    }

    const messageRoute = url.pathname.match(/^\/api\/conversations\/([a-f0-9-]+)\/messages$/i);
    if (request.method === 'POST' && messageRoute) {
      try {
        const body = await readJson(request);
        sendJson(response, 200, service.sendMessage(messageRoute[1], body.text));
      } catch (error) {
        sendJson(response, error.statusCode ?? 500, { error: error.message ?? 'The request failed.' });
      }
      return;
    }

    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      await sendStatic(response, url.pathname);
      return;
    }

    sendJson(response, 404, { error: 'Route not found.' });
  });
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const port = 3002;
  const host = '127.0.0.1';
  createSentaDemoServer().listen(port, host, () => {
    console.log(`Senta Checkout demo listening at http://${host}:${port}`);
  });
}
