// First-run checks (PLAN.md §7.1): can Claude Code run, and is the user signed in? Login itself always happens in the
// CLI. The app never touches credentials, and `claude auth status` also prints the email and organisation, which
// are dropped here and never leave this process.
import { exec, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Preflight, SessionInfo } from '@ci/shared';
import { listPast, recentFrom } from './history.ts';

const run = promisify(execFile);
const runShell = promisify(exec);
const MIN_VERSION = [2, 1, 0];

export function parseVersion(text: string): number[] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function isOlder(v: number[], than: number[] = MIN_VERSION): boolean {
  for (let i = 0; i < 3; i++) if (v[i]! !== than[i]!) return v[i]! < than[i]!;
  return false;
}

/** Keeps only what the UI may know. Anything else in the answer (email, org id, folders) is dropped. */
export function parseAuthStatus(text: string): { loggedIn: boolean; authMethod?: string; subscriptionType?: string } {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    return {
      loggedIn: j.loggedIn === true,
      authMethod: typeof j.authMethod === 'string' ? j.authMethod : undefined,
      subscriptionType: typeof j.subscriptionType === 'string' ? j.subscriptionType : undefined,
    };
  } catch {
    return { loggedIn: false };
  }
}

/** The Claude Code binary that ships with the SDK, if this platform has one installed. */
export function bundledBinary(): string | undefined {
  try {
    const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`;
    return join(dirname(createRequire(import.meta.url).resolve(pkg)), process.platform === 'win32' ? 'claude.exe' : 'claude');
  } catch {
    return undefined;
  }
}

async function tryRun(bin: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run(bin, args, { timeout: 20_000, windowsHide: true, maxBuffer: 1 << 20 });
    return stdout;
  } catch {
    return undefined;
  }
}

/** Is `claude` on PATH? Installed through npm it is a .cmd shim on Windows, which only a shell can start; the command is a fixed string. */
async function claudeOnPath(): Promise<boolean> {
  try {
    await runShell('claude --version', { timeout: 20_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function preflight(past?: SessionInfo[]): Promise<Preflight> {
  const bundled = bundledBinary();
  const onPath = await claudeOnPath();
  const bin = bundled ?? (onPath ? 'claude' : undefined);
  const version = bin ? parseVersion((await tryRun(bin, ['--version'])) ?? '') : undefined;
  const auth = bin ? parseAuthStatus((await tryRun(bin, ['auth', 'status', '--json'])) ?? '') : { loggedIn: false };
  const sessions = past ?? (await listPast().catch(() => []));
  return {
    cliFound: Boolean(bin && version),
    cliVersion: version?.join('.'),
    cliTooOld: version ? isOlder(version) : false,
    ...auth,
    loginCommand: onPath || !bundled ? 'claude auth login' : `"${bundled}" auth login`,
    recentProjects: recentFrom(sessions),
  };
}
