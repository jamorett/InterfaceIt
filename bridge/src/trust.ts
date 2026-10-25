// The CLI skips its own "do you trust this folder?" dialog when driven by an SDK (PLAN.md §3.5), so the app asks itself.
// A folder counts as trusted when the user already trusted it (or a parent folder) in the CLI, or answered yes here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type TrustFiles = { store: string; cliConfig: string };

export function defaultFiles(): TrustFiles {
  // an override so the smoke test can keep its throwaway folder out of the user's real trust list
  if (process.env.CLAUDEINTERFACE_TRUST_FILE) return { store: process.env.CLAUDEINTERFACE_TRUST_FILE, cliConfig: join(homedir(), '.claude.json') };
  const base = process.platform === 'win32' ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'ClaudeInterface') : join(homedir(), '.config', 'claudeinterface');
  return { store: join(base, 'trusted.json'), cliConfig: join(homedir(), '.claude.json') };
}

/** one spelling for comparing paths: forward slashes, no trailing slash, case-insensitive on Windows */
export function norm(p: string): string {
  const s = resolve(p).replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // missing or unreadable: treated as "nothing trusted here"
  }
}

function ancestors(p: string): string[] {
  const out: string[] = [];
  let cur = norm(p);
  for (;;) {
    out.push(cur);
    const up = cur.replace(/\/[^/]*$/, '');
    if (!up || up === cur) return out;
    cur = up.endsWith(':') ? `${up}/` : up; // "c:" → "c:/"
    if (out.includes(cur)) return out;
  }
}

export function isTrusted(cwd: string, files: TrustFiles = defaultFiles()): boolean {
  const places = new Set(ancestors(cwd));
  const mine = readJson(files.store);
  if (Array.isArray(mine) && mine.some((p) => typeof p === 'string' && places.has(norm(p)))) return true;
  const projects = (readJson(files.cliConfig) as { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> } | undefined)?.projects;
  if (!projects) return false;
  return Object.entries(projects).some(([p, v]) => v?.hasTrustDialogAccepted === true && places.has(norm(p)));
}

export function trust(cwd: string, files: TrustFiles = defaultFiles()): void {
  const current = readJson(files.store);
  const list = Array.isArray(current) ? current.filter((p): p is string => typeof p === 'string') : [];
  if (list.some((p) => norm(p) === norm(cwd))) return;
  mkdirSync(dirname(files.store), { recursive: true });
  writeFileSync(files.store, JSON.stringify([...list, resolve(cwd)], null, 2));
}

export const folderExists = (p: string) => existsSync(p);
