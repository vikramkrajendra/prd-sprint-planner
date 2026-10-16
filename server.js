// Entry point: HTTP server, API routing and static frontend.
const http = require('http');
const path = require('path');
const config = require('./src/config');
const { Router, sendJson, serveStatic } = require('./src/http');
const store = require('./src/db');

const router = new Router();
const PUBLIC_DIR = path.join(__dirname, 'public');

router.get('/api/health', () => ({ status: 'ok', time: new Date().toISOString() }));
require('./src/routes/workflows').register(router);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const started = Date.now();
  try {
    if (url.pathname.startsWith('/api/')) {
      const route = router.match(req.method, url.pathname);
      if (!route) return sendJson(res, 404, { error: 'Not found' });
      const result = await route.handler({ req, res, url, params: route.params, query: Object.fromEntries(url.searchParams) });
      if (!res.writableEnded) {
        const { __status, ...payload } = result || {};
        sendJson(res, __status || 200, payload);
      }
    } else if (!serveStatic(PUBLIC_DIR, url.pathname, res)) {
      sendJson(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    console.error(`[error] ${req.method} ${url.pathname}:`, err.message);
    if ((err.status || 500) >= 500) store.logActivity({ level: 'error', event: 'api.error', message: `${req.method} ${url.pathname}: ${err.message}` });
    else if (url.pathname === '/api/workflows' && req.method === 'POST') store.logActivity({ level: 'warn', event: 'input.rejected', message: err.message });
    if (!res.writableEnded) sendJson(res, err.status || 500, { error: err.message || 'Server error' });
  } finally {
    if (url.pathname.startsWith('/api/')) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

const driver = store.init();
store.logActivity({ event: 'server.started', message: `Server started (db: ${driver}, AI: ${config.openaiKey ? config.openaiModel : 'off'})` });

server.listen(config.port, '0.0.0.0', () => {
  console.log(`PRD → Sprint Planner running on http://localhost:${config.port} (db: ${driver})`);
});

module.exports = server;
