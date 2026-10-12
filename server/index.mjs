// Freight Returns BOL Portal server: serves the built UI (dist/) and the API (api/*.mjs).
//   npm run build && npm start      ->  http://localhost:8080
// Runs as-is in Docker (see Dockerfile). Paths are matched by suffix so the app works
// whether Acme's hub proxies it at "/", at a sub-path, or frames it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { store } from '../lib/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8080;
// Space-separated origins allowed to frame the app. Write `self` without quotes (.env files strip them).
const FRAME_ANCESTORS = (process.env.ALLOWED_FRAME_ANCESTORS || 'self https://hub-dev.example.com https://hub.example.com')
  .split(/\s+/).filter(Boolean).map((t) => (/^'?(self|none)'?$/.test(t) ? `'${t.replace(/'/g, '')}'` : t)).join(' ');
const SECURITY_HEADERS = {
  'content-security-policy': `frame-ancestors ${FRAME_ANCESTORS}`,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---- load API routes from api/*.mjs (each exports default handler + config.path)
const routes = {};
for (const f of fs.readdirSync(path.join(ROOT, 'api')).filter((x) => x.endsWith('.mjs'))) {
  const mod = await import(pathToFileURL(path.join(ROOT, 'api', f)).href);
  routes[mod.config.path] = { fn: mod.default, method: mod.config.method };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (p.endsWith('/healthz')) { res.writeHead(200, { 'content-type': 'text/plain', ...SECURITY_HEADERS }); return res.end('ok'); }

  const apiAt = p.lastIndexOf('/api/');
  const route = apiAt >= 0 && routes[p.slice(apiAt)];
  if (route) {
    if (route.method && req.method !== route.method) { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
    const chunks = [];
    for await (const c of req) { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 8e6) { res.writeHead(413); return res.end(); } }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.socket.remoteAddress || 'local');
    const r = await route.fn(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, { ...Object.fromEntries(r.headers), ...SECURITY_HEADERS });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }

  // ---- static UI: /…/assets/x.js -> dist/assets/x.js, anything else -> index.html
  const assetAt = p.lastIndexOf('/assets/');
  let file = assetAt >= 0 ? path.join(DIST, 'assets', path.basename(p)) : path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(503, SECURITY_HEADERS); return res.end('UI not built. Run "npm run build".'); }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': assetAt >= 0 ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => handle(req, res).catch((e) => {
  console.error(JSON.stringify({ where: 'server', error: String(e?.stack || e) }));
  if (!res.headersSent) res.writeHead(500);
  res.end();
}));

// ---- retention: purge history older than RETENTION_DAYS (purgeAfter is set when records are written)
async function purge() {
  try {
    const s = store();
    const now = new Date().toISOString();
    let n = 0;
    for (const prefix of ['log/', 'bol/']) {
      for (const k of await s.list(prefix)) {
        const v = await s.get(k);
        if (v?.purgeAfter && v.purgeAfter < now) { await s.delete(k); n++; }
      }
    }
    for (const k of await s.list('quote/')) {
      const v = await s.get(k);
      if (v?.createdAt && Date.now() - Date.parse(v.createdAt) > 7 * 86400000) { await s.delete(k); n++; }
    }
    if (n) console.log(JSON.stringify({ where: 'retention', purged: n }));
  } catch (e) { console.error(JSON.stringify({ where: 'retention', error: String(e) })); }
}
const purgeTimer = setInterval(purge, 24 * 3600 * 1000);
purge();

server.listen(PORT, () => console.log(JSON.stringify({
  msg: `Freight Returns portal listening on :${PORT}`,
  appMode: process.env.APP_MODE || 'mock', store: process.env.STORE || 'sqlite', auth: process.env.AUTH_MODE || 'hub',
})));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  clearInterval(purgeTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
