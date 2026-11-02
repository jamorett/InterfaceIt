import { existsSync, opendirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { resolveSafePath } from './read.ts';

export interface GlobToolInput {
  pattern: string;
  path?: string;
}

export interface GlobToolResult {
  text: string;
  isError: boolean;
  matches: string[];
}

const SKIP = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '.cache', '.turbo', 'coverage', '__pycache__',
  '.venv', 'venv', 'target', '.idea', '.vscode'
]);

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/');
  let regStr = '^';
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i]!;
    if (c === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          regStr += '(?:.+/)?';
          i += 3;
        } else {
          regStr += '.*';
          i += 2;
        }
      } else {
        regStr += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regStr += '[^/]';
      i++;
    } else if ('./+-^$()[]{}|'.includes(c)) {
      regStr += '\\' + c;
      i++;
    } else {
      regStr += c;
      i++;
    }
  }
  regStr += '$';
  return new RegExp(regStr, 'i');
}

export async function executeGlob(
  input: GlobToolInput,
  cwd: string,
  addDirs: string[] = []
): Promise<GlobToolResult> {
  const root = input.path ? resolveSafePath(cwd, input.path, addDirs) : cwd;
  if (!existsSync(root)) {
    return {
      text: `Error: Folder not found: ${input.path ?? cwd}`,
      isError: true,
      matches: [],
    };
  }

  const re = globToRegExp(input.pattern);
  const matches: string[] = [];
  const queue: string[] = [root];
  let count = 0;
  const MAX_MATCHES = 100;
  const MAX_VISITED = 15_000;

  while (queue.length && count < MAX_VISITED && matches.length < MAX_MATCHES) {
    const dir = queue.shift()!;
    let handle;
    try {
      handle = opendirSync(dir);
    } catch {
      continue;
    }

    try {
      let entry;
      while ((entry = handle.readSync()) && count < MAX_VISITED && matches.length < MAX_MATCHES) {
        count++;
        if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.claude') continue;
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
          if (!SKIP.has(entry.name)) queue.push(full);
        } else if (entry.isFile()) {
          const rel = relative(root, full).split(sep).join('/');
          if (re.test(rel) || re.test(entry.name)) {
            matches.push(rel);
          }
        }
      }
    } finally {
      handle.closeSync();
    }
  }

  if (matches.length === 0) {
    return {
      text: `No files matched pattern "${input.pattern}"`,
      isError: false,
      matches: [],
    };
  }

  return {
    text: matches.join('\n'),
    isError: false,
    matches,
  };
}

