import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getCachedSnapshot, getMarketSnapshot, getNiftyOptionTableSnapshot, getProviderInfo, isIndianMarketSession } from './live-data-service.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const port = Number(process.env.PORT || 8080);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.BQ_CORS_ORIGIN || '*'
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = normalize(filePath).replace(/^\.\.(\/|\\|$)/, '');
  const absolute = join(root, filePath);
  if (!absolute.startsWith(root) || !existsSync(absolute) || !statSync(absolute).isFile()) {
    const fallback = join(root, '404.html');
    if (existsSync(fallback)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      createReadStream(fallback).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
    return;
  }
  res.writeHead(200, {
    'Content-Type': mime[extname(absolute)] || 'application/octet-stream',
    'Cache-Control': filePath === '/index.html' ? 'no-cache' : 'public, max-age=60'
  });
  createReadStream(absolute).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': process.env.BQ_CORS_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }
    if (url.pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        marketSessionOpen: isIndianMarketSession(),
        cached: !!getCachedSnapshot(),
        provider: getProviderInfo(),
        time: new Date().toISOString()
      });
      return;
    }
    if (url.pathname === '/api/market/snapshot') {
      const force = url.searchParams.get('force') === '1';
      const snapshot = await getMarketSnapshot({ force });
      sendJson(res, 200, snapshot);
      return;
    }
    if (url.pathname === '/api/options/nifty-table') {
      const force = url.searchParams.get('force') === '1';
      const snapshot = await getNiftyOptionTableSnapshot({ force });
      if (!snapshot) sendJson(res, 503, { ok: false, error: 'No official option-chain snapshot available. Configure UPSTOX_ACCESS_TOKEN.' });
      else sendJson(res, 200, snapshot);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
});

server.listen(port, () => {
  console.log(`Trade X live server running on http://localhost:${port}`);
  console.log('Market data endpoint: /api/market/snapshot');
  console.log('During 09:00-15:00 IST the frontend attempts price refresh every ~1 second.');
});
