import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http, { type IncomingHttpHeaders } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build as viteBuild } from 'vite';
import { createLocalServer, DIST, WEB_ROOT } from '../src/index.mjs';

const server = createLocalServer();
let port = 0;

before(async () => {
  try {
    await fs.access(path.join(DIST, 'index.html'));
  } catch {
    await viteBuild({ root: WEB_ROOT, logLevel: 'silent' });
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (addr && typeof addr === 'object') {
    port = addr.port;
  }
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
});

interface HttpTestResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const decoder = new TextDecoder('utf-8');

const request = (
  urlPath: string,
  method = 'GET',
  extraHeaders: Record<string, string> = {},
): Promise<HttpTestResponse> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers: extraHeaders },
      (res) => {
        const chunks: Uint8Array[] = [];
        let totalLength = 0;
        res.on('data', (chunk: Uint8Array) => {
          chunks.push(chunk);
          totalLength += chunk.byteLength;
        });
        res.on('end', () => {
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: decoder.decode(merged),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

test('Server binds only the loopback interface', () => {
  const addr = server.address();
  assert(addr && typeof addr === 'object');
  assert.equal(addr.address, '127.0.0.1');
});

test('Health accurately reports local-only, not multiplayer', async () => {
  const r = await request('/health');
  assert.equal(r.status, 200);
  const parsed = JSON.parse(r.body) as { ok: boolean; multiplayer: boolean; mode: string };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.multiplayer, false);
  assert.equal(parsed.mode, 'local-only');
});

test('Production HTML is served with bundled local assets', async () => {
  const r = await request('/');
  assert.equal(r.status, 200);
  assert.match(r.body, /<title>Neon Race · V3 Local<\/title>/);
  assert.match(r.body, /<div id="root"><\/div>/);
  assert.match(r.body, /src="\/assets\/[^"]+\.js"/);
});

test('Bundled CSS and JS assets in dist/ are served with correct MIME types', async () => {
  const indexHtml = (await request('/')).body;
  const cssMatch = indexHtml.match(/href="(\/assets\/[^"]+\.css)"/);
  const jsMatch = indexHtml.match(/src="(\/assets\/[^"]+\.js)"/);
  if (!cssMatch || !jsMatch) {
    throw new Error('Expected bundled CSS and JS links in web/dist/index.html');
  }

  const cssRes = await request(cssMatch[1]);
  assert.equal(cssRes.status, 200);
  assert.match(String(cssRes.headers['content-type']), /text\/css/);

  const jsRes = await request(jsMatch[1]);
  assert.equal(jsRes.status, 200);
  assert.match(String(jsRes.headers['content-type']), /javascript/);
});

test('Source, config, and server files are never publicly served', async () => {
  for (const p of [
    '/src/main.tsx',
    '/backend/src/index.mjs',
    '/package.json',
    '/tsconfig.json',
    '/vite.config.ts',
    '/node_modules/three/package.json',
  ]) {
    assert.equal((await request(p)).status, 404, p);
  }
});

test('Traversal and malformed path requests are rejected', async () => {
  for (const p of [
    '/../package.json',
    '/%2e%2e/package.json',
    '/assets/%2e%2e/../backend/src/index.mjs',
    '/%5c..%5cpackage.json',
    '/%00',
  ]) {
    assert.equal((await request(p)).status, 403, p);
  }
  assert.equal((await request('/%ZZ')).status, 400);
});

test('Non-local Host headers are rejected', async () => {
  assert.equal((await request('/', 'GET', { Host: 'evil.example' })).status, 403);
});

test('POST cannot modify files', async () => {
  assert.equal((await request('/', 'POST')).status, 405);
});

test('HEAD returns metadata but no response body', async () => {
  const r = await request('/', 'HEAD');
  assert.equal(r.status, 200);
  assert.equal(r.body, '');
  assert(Number(r.headers['content-length']) > 0);
});

test('CSP does not permit external scripts or evaluation', async () => {
  const csp = String((await request('/')).headers['content-security-policy']);
  assert.match(csp, /script-src 'self';/);
  assert(!csp.includes('unsafe-eval'));
});

test('Source and built dist files contain no external CDN, font or remote URL (offline readiness)', async () => {
  const checkFiles: string[] = [
    path.join(WEB_ROOT, 'index.html'),
    path.join(WEB_ROOT, 'src', 'styles', 'game.css'),
    path.join(DIST, 'index.html'),
  ];
  const assetsDir = path.join(DIST, 'assets');
  const assetEntries = await fs.readdir(assetsDir);
  for (const name of assetEntries) {
    if (name.endsWith('.css')) {
      checkFiles.push(path.join(assetsDir, name));
    }
  }
  for (const file of checkFiles) {
    const text = await fs.readFile(file, 'utf8');
    assert(!/https?:\/\/|fonts\.google|cdnjs|unpkg|jsdelivr/.test(text), `External URL found in ${file}`);
  }
});
