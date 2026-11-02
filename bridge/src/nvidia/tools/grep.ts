import { existsSync, opendirSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { globToRegExp } from './glob.ts';
import { resolveSafePath } from './read.ts';

export interface GrepToolInput {
  query: string;
  path?: string;
  is_regex?: boolean;
  /** only search files whose path or name matches this glob, e.g. "*.ts" */
  glob?: string;
  /** lines to show around each match (0-5) */
  context?: number;
  case_sensitive?: boolean;
  /** list only the files that match, not the lines */
  files_only?: boolean;
}

export interface GrepToolResult {
  text: string;
  isError: boolean;
  matchCount: number;
}

const SKIP = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '.cache', '.turbo', 'coverage', '__pycache__',
  '.venv', 'venv', 'target', '.idea', '.vscode'
]);

const MAX_MATCHES = 80;
const MAX_FILE_SIZE = 2_000_000; // 2 MB

export async function executeGrep(
  input: GrepToolInput,
  cwd: string,
  addDirs: string[] = []
): Promise<GrepToolResult> {
  const root = input.path ? resolveSafePath(cwd, input.path, addDirs) : cwd;
  if (!existsSync(root)) {
    return {
      text: `Error: Folder not found: ${input.path ?? cwd}`,
      isError: true,
      matchCount: 0,
    };
  }

  let regex: RegExp;
  const flags = input.case_sensitive ? '' : 'i';
  const ctx = Math.min(Math.max(Math.trunc(Number(input.context) || 0), 0), 5);
  const fileGlob = input.glob ? globToRegExp(input.glob) : undefined;
  const matchedFiles = new Set<string>();
  try {
    regex = input.is_regex ? new RegExp(input.query, flags) : new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch (err) {
    return {
      text: `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
      matchCount: 0,
    };
  }

  const matches: string[] = [];
  const queue: string[] = [root];
  let visitedFiles = 0;

  while (queue.length && matches.length < MAX_MATCHES) {
    const dir = queue.shift()!;
    let handle;
    try {
      handle = opendirSync(dir);
    } catch {
      continue;
    }

    try {
      let entry;
      while ((entry = handle.readSync()) && matches.length < MAX_MATCHES) {
        if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.claude') continue;
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
          if (!SKIP.has(entry.name)) queue.push(full);
        } else if (entry.isFile()) {
          visitedFiles++;
          try {
            const st = statSync(full);
            if (st.size > MAX_FILE_SIZE) continue;

            const fh = await open(full, 'r');
            try {
              const buf = Buffer.alloc(256);
              const { bytesRead } = await fh.read(buf, 0, 256, 0);
              let isBinary = false;
              for (let i = 0; i < bytesRead; i++) {
                if (buf[i] === 0) { isBinary = true; break; }
              }
              if (isBinary) continue;

              const content = await fh.readFile({ encoding: 'utf-8' });
              const lines = content.split(/\r?\n/);
              const rel = relative(root, full).split(sep).join('/');
              if (fileGlob && !fileGlob.test(rel) && !fileGlob.test(entry.name)) continue;

              let lastShown = -1;
              for (let l = 0; l < lines.length && matches.length < MAX_MATCHES; l++) {
                if (!regex.test(lines[l]!)) continue;
                matchedFiles.add(rel);
                if (input.files_only) break;
                // context lines around the match, without repeating a line already shown
                for (let c = Math.max(l - ctx, lastShown + 1); c <= Math.min(l + ctx, lines.length - 1); c++) {
                  matches.push(`${rel}${c === l ? ':' : '-'}${c + 1}${c === l ? ':' : '-'} ${lines[c]!.trimEnd()}`);
                  lastShown = c;
                }
                if (ctx > 0 && l + ctx < lines.length - 1) matches.push('--');
              }
              if (input.files_only && matchedFiles.has(rel)) matches.push(rel);
            } finally {
              await fh.close();
            }
          } catch {
            // ignore unreadable files
          }
        }
      }
    } finally {
      handle.closeSync();
    }
  }

  if (matches.length === 0) {
    return {
      text: `No matches found for query "${input.query}" (searched ${visitedFiles} files)`,
      isError: false,
      matchCount: 0,
    };
  }

  return {
    text: matches.join('\n'),
    isError: false,
    matchCount: matches.length,
  };
}

