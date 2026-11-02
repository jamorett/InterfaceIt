import { spawn, type ChildProcess } from 'node:child_process';
import { resolveShell } from './shellResolver.ts';

export interface BashToolInput {
  command: string;
  timeoutMs?: number;
}

export interface BashToolResult {
  text: string;
  isError: boolean;
  exitCode: number | null;
  truncated?: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000; // 60s
const MAX_OUTPUT_BYTES = 500_000; // 500 KB
const MAX_TIMEOUT_MS = 600_000; // the model cannot ask for more than 10 minutes

/** proc.kill() on Windows leaves the children (npm → node) running; taskkill /T takes the whole tree. */
export function killTree(proc: ChildProcess): void {
  try {
    if (process.platform === 'win32' && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    else proc.kill('SIGKILL');
  } catch { /* already gone */ }
}

export async function executeBash(
  input: BashToolInput,
  cwd: string,
  signal?: AbortSignal
): Promise<BashToolResult> {
  const shell = resolveShell();
  const args = shell.buildArgs(input.command);
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);

  return new Promise<BashToolResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let bytesCollected = 0;
    let truncated = false;
    let settled = false;

    const proc = spawn(shell.path, args, {
      cwd,
      env: {
        ...process.env,
        CI: 'true',
        TERM: 'dumb',
        FORCE_COLOR: '0',
      },
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        killTree(proc);
        resolve({
          text: `Command timed out after ${timeoutMs / 1000}s:\n${stdout}\n${stderr}`,
          isError: true,
          exitCode: null,
          truncated,
        });
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        killTree(proc);
        resolve({
          text: `Command aborted by user:\n${stdout}\n${stderr}`,
          isError: true,
          exitCode: null,
          truncated,
        });
      }
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const appendChunk = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      if (bytesCollected >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      const str = chunk.toString('utf-8');
      bytesCollected += chunk.length;
      if (target === 'stdout') stdout += str;
      else stderr += str;
    };

    proc.stdout?.on('data', (d: Buffer) => appendChunk(d, 'stdout'));
    proc.stderr?.on('data', (d: Buffer) => appendChunk(d, 'stderr'));

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve({
          text: `Failed to spawn shell (${shell.path}): ${err.message}`,
          isError: true,
          exitCode: null,
        });
      }
    });

    proc.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);

        let out = '';
        if (stdout.length > 0) out += stdout;
        if (stderr.length > 0) {
          if (out.length > 0 && !out.endsWith('\n')) out += '\n';
          out += stderr;
        }

        if (out.trim().length === 0) {
          out = `(Process exited with code ${code ?? 0} and no output)`;
        }

        resolve({
          text: out,
          isError: code !== 0,
          exitCode: code,
          truncated,
        });
      }
    });
  });
}

