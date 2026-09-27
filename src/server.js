import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from './runtime.js';
import { loadConfig } from './config.js';
import { sendError, sendJson } from './http/responses.js';
import { createConversationRoutes } from './http/routes/conversationRoutes.js';
import { createOrderRoutes } from './http/routes/orderRoutes.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDirectory = resolve(here, '../public');
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);
async function sendStatic(response, pathname) {
  const requestedPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const allowedFiles = new Set(['index.html', 'app.js', 'auth.js', 'styles.css']);
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

export function createSentaDemoServer({ runtime = null } = {}) {
  const authRoutes = runtime?.authRoutes;
  const conversationRoutes = runtime && createConversationRoutes({
    conversations: runtime.conversationService,
    authService: runtime.authService,
  });
  const orderRoutes = runtime && createOrderRoutes({ orders: runtime.orders, authService: runtime.authService });
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('content-security-policy', "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, { status: 'ok', storage: runtime ? 'sqlite' : 'unavailable' });
        return;
      }
      if (authRoutes && await authRoutes(request, response, url)) return;
      if (runtime && request.method === 'GET' && url.pathname === '/api/catalog') {
        sendJson(response, 200, { restaurants: runtime.catalog.listActive() }, { 'cache-control': 'public, max-age=60' });
        return;
      }
      if (conversationRoutes && await conversationRoutes(request, response, url)) return;
      if (orderRoutes && await orderRoutes(request, response, url)) return;

      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        await sendStatic(response, url.pathname);
        return;
      }

      sendJson(response, 404, { error: 'Route not found.', code: 'not_found' });
    } catch (error) {
      sendError(response, error);
    }
  });
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const config = loadConfig();
  const runtime = createRuntime({ config });
  const server = createSentaDemoServer({ runtime });
  server.listen(config.port, config.host, () => {
    console.log(`Senta Checkout listening at http://${config.host}:${config.port}`);
  });
  const close = () => server.close(() => runtime.close());
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
