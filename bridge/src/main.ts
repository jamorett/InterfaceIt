import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Preflight } from '@ci/shared';
import { createApp, type Deps } from './app.ts';
import { FixtureSession } from './fixture.ts';
import { searchFiles } from './fs.ts';
import { listPast, loadMessages } from './history.ts';
import { preflight } from './preflight.ts';
import { SdkSession } from './session.ts';
import { SessionManager } from './sessions.ts';
import { attachWs } from './server.ts';
import { isTrusted, trust } from './trust.ts';

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
// --fake replays the recordings in bridge/test/fixtures instead of calling Claude: UI tests use it, so they never spend usage
const fake = args.has('--fake');
const fakePreflight: Preflight = { cliFound: true, cliVersion: '2.1.310', cliTooOld: false, loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro', loginCommand: 'claude auth login', recentProjects: ['C:/demo/ClaudeInterface', 'C:/demo/notes-site'] };
const fakeTrusted = new Set<string>();
const manager = new SessionManager(
  fake ? (spec, id) => new FixtureSession(spec.cwd, id) : (spec, id) => new SdkSession(spec, id),
  fake ? async () => [] : loadMessages,
);
const deps: Deps = fake
  ? { manager, preflight: async () => fakePreflight, listPast: async () => [], isTrusted: (c) => !c.includes('untrusted') || fakeTrusted.has(c), trust: (c) => void fakeTrusted.add(c), isFolder: () => true, searchFiles: (_cwd, q) => ['README.md', 'ui/src/store.ts', 'ui/src/App.tsx', 'bridge/src/session.ts', 'docs/notes.md'].filter((p) => p.toLowerCase().includes(q.toLowerCase())) }
  : { manager, preflight: () => preflight(), listPast, isTrusted: (c) => isTrusted(c), trust: (c) => trust(c), searchFiles: (cwd, q) => searchFiles(cwd, q) };
attachWs(server, { token, allowedOrigins: hosts.map((h) => `http://${h}`), connect: createApp(deps) });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { manager.closeAll(); process.exit(0); });

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
