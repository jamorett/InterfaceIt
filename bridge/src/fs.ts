// File names for "@" mentions. Read-only, and confined to the folder the session works in (PLAN.md §4 rule 6):
// it never follows a link out of the folder and never returns a path outside it.
import { opendirSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Folders that are never worth offering (and can hold hundreds of thousands of files). */
const SKIP = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.turbo', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode-test']);
const MAX_VISITED = 20_000;

/** How well `path` matches what the user typed; higher is better, 0 is no match. A match in the file name beats one in a folder name; shorter beats longer. */
export function score(path: string, query: string): number {
  const p = path.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1000 - Math.min(path.length, 999);
  const name = p.slice(p.lastIndexOf('/') + 1);
  let s = 0;
  if (name === q) s = 900;
  else if (name.startsWith(q)) s = 800;
  else if (name.includes(q)) s = 700;
  else if (p.includes(q)) s = 500;
  else {
    // letters in order ("sst" finds "ui/src/store.ts"): weak, but handy
    let i = 0;
    for (const ch of p) if (ch === q[i]) i++;
    if (i === q.length) s = 200;
  }
  return s ? s + Math.max(0, 99 - path.length / 4) : 0;
}

/** Up to `limit` files under `root` whose path matches `query`, best first. Paths use "/" and are relative to `root`. */
export function searchFiles(root: string, query: string, limit = 12): string[] {
  const found: { path: string; score: number }[] = [];
  const queue: string[] = [root];
  let visited = 0;
  while (queue.length && visited < MAX_VISITED) {
    const dir = queue.shift()!;
    let handle;
    try {
      handle = opendirSync(dir);
    } catch {
      continue; // no permission, or it vanished
    }
    try {
      let entry: Dirent | null;
      while ((entry = handle.readSync()) && visited < MAX_VISITED) {
        visited++;
        if (entry.name.startsWith('.') && entry.name !== '.github') continue; // dot-folders and dot-files are usually secrets or tooling
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue; // a link could lead out of the folder
        if (entry.isDirectory()) {
          if (!SKIP.has(entry.name)) queue.push(full);
        } else if (entry.isFile()) {
          const rel = relative(root, full).split(sep).join('/');
          const s = score(rel, query);
          if (s) found.push({ path: rel, score: s });
        }
      }
    } finally {
      handle.closeSync();
    }
  }
  return found.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit).map((f) => f.path);
}
