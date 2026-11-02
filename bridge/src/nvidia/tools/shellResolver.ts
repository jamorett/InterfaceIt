import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ShellType = 'bash' | 'pwsh' | 'powershell' | 'cmd';

export interface ResolvedShell {
  path: string;
  type: ShellType;
  buildArgs: (command: string) => string[];
}

let cachedShell: ResolvedShell | undefined;

/**
 * Deterministically resolves the best available shell for running commands.
 * On Windows:
 *   1. Probes Git Bash at known standard paths (best POSIX compatibility).
 *   2. Probes PowerShell 7 (pwsh).
 *   3. Falls back to Windows PowerShell via its absolute System32 path.
 * On Unix (macOS / Linux):
 *   Probes /bin/bash, /usr/bin/bash, or falls back to /bin/sh.
 */
export function resolveShell(): ResolvedShell {
  if (cachedShell) return cachedShell;

  const isWin = process.platform === 'win32';

  if (!isWin) {
    const candidates = ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/bin/sh'];
    for (const cand of candidates) {
      if (existsSync(cand)) {
        cachedShell = {
          path: cand,
          type: 'bash',
          buildArgs: (cmd) => ['-c', cmd],
        };
        return cachedShell;
      }
    }
    cachedShell = {
      path: '/bin/sh',
      type: 'bash',
      buildArgs: (cmd) => ['-c', cmd],
    };
    return cachedShell;
  }

  // Windows: 1. Try Git Bash
  const gitBashCandidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ];

  // Git installed somewhere else: bash.exe sits in bin\ next to cmd\git.exe
  try {
    for (const g of execFileSync('where', ['git'], { encoding: 'utf-8', windowsHide: true, timeout: 3000 }).split(/\r?\n/)) {
      if (g.trim()) gitBashCandidates.push(join(dirname(dirname(g.trim())), 'bin', 'bash.exe'));
    }
  } catch { /* git is not on PATH */ }

  for (const cand of gitBashCandidates) {
    if (cand && existsSync(cand)) {
      cachedShell = {
        path: cand,
        type: 'bash',
        buildArgs: (cmd) => ['-c', cmd],
      };
      return cachedShell;
    }
  }

  // Windows: 2. Try PowerShell 7 (pwsh)
  const pwshCandidates = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'PowerShell', '7', 'pwsh.exe'),
  ];

  for (const cand of pwshCandidates) {
    if (cand && existsSync(cand)) {
      cachedShell = {
        path: cand,
        type: 'pwsh',
        buildArgs: (cmd) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      };
      return cachedShell;
    }
  }

  // Windows: 3. Fallback to Windows PowerShell using absolute System32 path
  const sysRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
  const winPsCandidates = [
    join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    join(sysRoot, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  ];

  for (const cand of winPsCandidates) {
    if (existsSync(cand)) {
      cachedShell = {
        path: cand,
        type: 'powershell',
        buildArgs: (cmd) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      };
      return cachedShell;
    }
  }

  // Final fallback to process.env.COMSPEC (cmd.exe)
  const cmdExe = process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe';
  cachedShell = {
    path: cmdExe,
    type: 'cmd',
    buildArgs: (cmd) => ['/c', cmd],
  };
  return cachedShell;
}

