import { existsSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize, resolve } from 'node:path';

export interface ReadToolInput {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface ReadToolResult {
  text: string;
  isError: boolean;
  truncated?: boolean;
}

const MAX_FILE_SIZE = 1_000_000; // 1 MB limit before partial reading
const MAX_LINES = 2000;

/**
 * Git Bash writes Windows paths as /c/Users/x and /tmp/x, and the agent copies them from `pwd`. Node needs the Windows form,
 * so those paths are turned back; anything else is left alone.
 */
export function fromShellPath(p: string): string {
  if (process.platform !== 'win32') return p;
  const drive = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (drive) return `${drive[1]!.toUpperCase()}:/${drive[2] ?? ''}`;
  const tmp = /^\/tmp(?:\/(.*))?$/.exec(p);
  return tmp ? join(tmpdir(), tmp[1] ?? '') : p;
}

export function isPathInsideRoots(cwd: string, targetPath: string, addDirs: string[] = []): boolean {
  targetPath = fromShellPath(targetPath);
  const abs = isAbsolute(targetPath) ? normalize(targetPath) : resolve(cwd, targetPath);
  const normalizedCwd = normalize(cwd);
  const allowedRoots = [normalizedCwd, ...addDirs.map(normalize)];

  return allowedRoots.some((root) =>
    abs === root ||
    abs.startsWith(root.endsWith('\\') || root.endsWith('/') ? root : root + '\\') ||
    abs.startsWith(root + '/')
  );
}

export function resolveSafePath(cwd: string, targetPath: string, addDirs: string[] = []): string {
  targetPath = fromShellPath(targetPath);
  return isAbsolute(targetPath) ? normalize(targetPath) : resolve(cwd, targetPath);
}

export async function executeRead(
  input: ReadToolInput,
  cwd: string,
  addDirs: string[] = []
): Promise<ReadToolResult> {
  const safePath = resolveSafePath(cwd, input.path, addDirs);

  if (!existsSync(safePath)) {
    return {
      text: `Error: File not found: ${input.path}`,
      isError: true,
    };
  }

  const stat = statSync(safePath);
  if (stat.isDirectory()) {
    return {
      text: `Error: Path is a directory, not a file: ${input.path}`,
      isError: true,
    };
  }

  // Check for binary file by inspecting first 512 bytes
  const fh = await open(safePath, 'r');
  try {
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) {
        return {
          text: `[Binary file (${stat.size} bytes)]`,
          isError: false,
        };
      }
    }

    const content = await fh.readFile({ encoding: 'utf-8' });
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;

    let start = 1;
    let end = totalLines;

    if (typeof input.startLine === 'number' && input.startLine > 0) {
      start = Math.min(input.startLine, totalLines);
    }
    if (typeof input.endLine === 'number' && input.endLine >= start) {
      end = Math.min(input.endLine, totalLines);
    }
    // a whole file is capped, so one read cannot swamp the context; the model is told how to get the rest
    const capped = input.endLine === undefined && end - start + 1 > MAX_LINES;
    if (capped) end = start + MAX_LINES - 1;

    const sliced = lines.slice(start - 1, end);
    const numbered = sliced.map((line, idx) => `${start + idx}→${line}`).join('\n');

    return {
      text: capped ? `${numbered}\n\n[showing lines ${start}-${end} of ${totalLines}; pass startLine/endLine to read more]` : numbered,
      isError: false,
      truncated: capped || stat.size > MAX_FILE_SIZE,
    };
  } catch (err) {
    return {
      text: `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  } finally {
    await fh.close();
  }
}

