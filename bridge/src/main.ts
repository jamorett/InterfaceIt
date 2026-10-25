import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWs } from './server.ts';

const args = new Set(process.argv.slice(2));
const port = Number(process.env.CLAUDEINTERFACE_PORT ?? 4317);
// the env override exists for tests only; real runs get a fresh random token
const token = process.env.CLAUDEINTERFACE_TOKEN ?? randomBytes(32).toString('hex');
if (!/^[0-9a-f]{32,}$/.test(token)) {
  console.error('CLAUDEINTERFACE_TOKEN must be at least 32 hex characters.');
  process.exit(1);
}

const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
const uiDir = fileURLToPath(new URL('../../ui/', import.meta.url));
const distDir = join(uiDir, 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = join(distDir, rel);
  if (file !== distDir && !file.startsWith(distDir + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(distDir, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(500).end('ui/dist is missing: run "npm run build" first.');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer();
let vite: Awaited<ReturnType<typeof import('vite').createServer>> | undefined;
if (args.has('--dev')) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ root: uiDir, appType: 'spa', server: { middlewareMode: true, hmr: { server } } });
}

server.on('request', (req, res) => {
  // blocks DNS rebinding: a hostile page can reach 127.0.0.1 but cannot forge the Host header
  if (!hosts.includes(req.headers.host ?? '')) {
    res.writeHead(403).end();
    return;
  }
  if (vite) vite.middlewares(req, res, () => res.writeHead(404).end());
  else serveStatic(req, res);
});
attachWs(server, { token, allowedOrigins: hosts.map((h) => `http://${h}`) });

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(
    err.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Close the other instance or set CLAUDEINTERFACE_PORT.`
      : err.message,
  );
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/#t=${token}`;
  console.log(`\nOpen this link (type "url" + Enter here to print it again):\n  ${url}\n`);
  process.stdin.on('data', (d) => {
    if (d.toString().trim() === 'url') console.log(url);
  });
  if (args.has('--no-open')) return;
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} "${url}"`);
});
