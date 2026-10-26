// Zero-dependency local server: serves /public and runs /api/**/*.js handlers the
// same way Vercel does (default export with a Web-standard fetch(request)).
// Usage: npm run dev  (reads .env.local if present)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const publicDir = join(root, 'public');
const port = Number(process.env.PORT) || 3000;

const envFile = join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// The same response headers as production (vercel.json), so local tests run under
// the real Content Security Policy. HTTPS-only parts are dropped for http://localhost.
const VERCEL_HEADERS = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).headers || [];
function configHeaders(pathname) {
  const out = {};
  for (const rule of VERCEL_HEADERS) {
    const re = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*')}$`);
    if (!re.test(pathname)) continue;
    for (const { key, value } of rule.headers) {
      if (key === 'Strict-Transport-Security') continue;
      out[key.toLowerCase()] = key === 'Content-Security-Policy' ? value.replace(/;\s*upgrade-insecure-requests/, '') : value;
    }
  }
  return out;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

async function runApi(req, res, pathname) {
  const file = join(root, normalize(pathname).replace(/^\/+/, '') + '.js');
  if (!file.startsWith(join(root, 'api')) || !existsSync(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
  const mod = await import(pathToFileURL(file).href);
  const response = await mod.default.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(res, pathname) {
  let file = join(publicDir, normalize(pathname));
  if (!file.startsWith(publicDir)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    return res.writeHead(404).end('Not found');
  }
  const headers = { ...configHeaders(pathname), 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
  res.writeHead(200, headers).end(await readFile(file));
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) await runApi(req, res, pathname);
    else await serveStatic(res, decodeURIComponent(pathname));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
}).listen(port, () => console.log(`Track running at http://localhost:${port}`));
