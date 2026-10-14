import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const WEB_ROOT = path.join(REPO_ROOT, 'web');
export const DIST = path.join(WEB_ROOT, 'dist');

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ogg', 'audio/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.bin', 'application/octet-stream'],
]);

const inside = (base, candidate) => {
  const rel = path.relative(base, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};

const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

/** Static file server for production web/dist/ build only. Local-only loopback binding. */
export function createLocalServer(distDir = DIST) {
  return http.createServer(async (req, res) => {
    const reply = (code, message) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(code, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : message);
    };

    const expectedPort = req.socket.localPort;
    const host = req.headers.host?.toLowerCase();
    if (![`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`].includes(host)) {
      reply(403, 'Faqat lokal manzilga ruxsat berilgan.');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      reply(405, 'Bu usulga ruxsat berilmagan.');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      reply(400, 'Manzil noto‘g‘ri.');
      return;
    }

    if (
      !pathname.startsWith('/') ||
      pathname.includes('\\') ||
      pathname.includes('\0') ||
      pathname.includes(':') ||
      pathname.split('/').some((s) => s.startsWith('.'))
    ) {
      reply(403, 'Bu yo‘lga ruxsat yo‘q.');
      return;
    }

    if (pathname === '/health') {
      const body = JSON.stringify({
        ok: true,
        name: 'neon-race',
        version: '0.2.0',
        mode: 'local-only',
        multiplayer: false,
      });
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = path.resolve(distDir, relative);
    if (!inside(distDir, target) || !TYPES.has(path.extname(target))) {
      reply(404, 'Fayl topilmadi.');
      return;
    }

    try {
      // Resolve symlinks as well as dot-segments: never expose web/src/, backend/ or node_modules/.
      const [canonicalBase, canonical] = await Promise.all([realpath(distDir), realpath(target)]);
      if (!inside(canonicalBase, canonical)) {
        reply(403, 'Fayl loyiha ichida xizmat qilinmaydi.');
        return;
      }
      const info = await stat(canonical);
      if (!info.isFile()) {
        reply(404, 'Fayl topilmadi.');
        return;
      }
      res.writeHead(200, {
        ...headers,
        'Content-Type': TYPES.get(path.extname(target)),
        'Content-Length': info.size,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(canonical);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        reply(404, 'Fayl topilmadi.');
      } else {
        console.error('[HTTP]', error.message);
        reply(500, 'Faylni o‘qishda xato.');
      }
    }
  });
}

async function start() {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('PORT 1024–65535 oralig‘idagi butun son bo‘lishi kerak.');
  }
  try {
    await access(path.join(DIST, 'index.html'));
  } catch {
    throw new Error('web/dist/index.html topilmadi. Avval npm run build buyrug‘ini bajaring.');
  }

  const server = createLocalServer();
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${port} band. Oldingi serverni Ctrl+C bilan to‘xtating yoki PowerShell’da $env:PORT=4174; npm start buyrug‘ini bajaring.`
        : `Server xatosi: ${error.message}`,
    );
    process.exitCode = 1;
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(
      `\nNeon Race (web/dist) ishlayapti\nManzil: http://127.0.0.1:${port}\nFaqat shu kompyuter. Hozircha multiplayer yo‘q.\nTo‘xtatish: Ctrl+C\n`,
    );
  });

  const stop = () => {
    console.log('\nServer to‘xtatildi.');
    server.close();
    server.closeAllConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
