import type { PermissionMode } from '@ci/shared';
import { isPathInsideRoots } from './tools/read.ts';
import { screenshotTarget } from './tools/screenshot.ts';

export type Verdict = { kind: 'allow' } | { kind: 'ask' } | { kind: 'deny'; message: string };

// analyze_image and detect_objects only read an image file (inside the workspace) and send it to the same NVIDIA account
const READ_TOOLS = new Set(['read_file', 'glob', 'grep', 'load_skill', 'analyze_image', 'detect_objects']);
const EDIT_TOOLS = new Set(['write_file', 'edit_file']);
const SESSION_TOOLS = new Set(['invoke_subagent', 'exit_plan', 'ask_user_question', 'TodoWrite', 'set_thinking', 'bash_output', 'bash_kill']);

// --- `auto` mode: which shell commands run without asking ---------------------------------------------------------------
// A command is safe when it is a chain (&&, ||, ;, |) of simple commands that each pass the table below, with no variable or
// command substitution, no subshell, no redirection to a file and no background `&`. Anything else asks the user.
// shortcut: a fixed allowlist instead of a classifier; widen the tables when `auto` asks for something routine.

/** programs that only read or print (their path-like arguments must stay inside the workspace) */
const READ_ONLY = new Set(['ls', 'dir', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'type', 'grep', 'rg', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp', 'stat', 'file', 'which', 'where', 'basename', 'dirname', 'realpath', 'true', 'false']);
/** build, test and lint tools a project installs for itself */
const DEV_TOOLS = new Set(['tsc', 'vitest', 'vite', 'eslint', 'prettier', 'jest', 'mocha', 'esbuild', 'playwright']);
/** package-manager subcommands that run the project's own scripts; installs and publishes are not here on purpose */
const PM_RUN = new Set(['run', 'run-script', 'test', 'start', 'build', 'lint', 'ls', 'list']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe']);
/** file operations: every path argument must be inside the workspace */
const FS_OPS = new Set(['mkdir', 'touch', 'cp', 'mv', 'cd']);

/** Splits a command into simple commands, or undefined if it uses anything the allowlist cannot judge. */
function simpleCommands(command: string): string[][] | undefined {
  // the harmless redirections: to the null device, and stderr into stdout
  const cmd = command.replace(/\s*(?:&>|[12]?>)\s*\/dev\/null(?![\w/.-])/g, '').replace(/\s*(?:2>&1|>&2|1>&2)/g, '');
  const out: string[][] = [];
  let cur: string[] = [];
  let word = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  let dangling = false;
  const endWord = () => { if (has) cur.push(word); word = ''; has = false; };
  const endCommand = () => { endWord(); if (!cur.length) return false; out.push(cur); cur = []; return true; };

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (quote === "'") { if (c === "'") quote = null; else word += c; continue; }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === '$' || c === '`' || c === '\\') return undefined; // expansion inside double quotes
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; has = true; dangling = false; continue; }
    if ('$`\\()<>\n\r'.includes(c)) return undefined;
    if (c === ' ' || c === '\t') { endWord(); continue; }
    if (c === '&') { if (cmd[i + 1] !== '&' || !endCommand()) return undefined; i++; dangling = true; continue; } // a lone & runs in the background
    if (c === '|') { if (!endCommand()) return undefined; if (cmd[i + 1] === '|') i++; dangling = true; continue; }
    if (c === ';') { if (!endCommand()) return undefined; continue; }
    word += c;
    has = true;
    dangling = false;
  }
  if (quote || dangling) return undefined; // an operator with nothing after it would wait for more input
  endWord();
  if (cur.length) out.push(cur);
  return out.length ? out : undefined;
}

const flagsOf = (args: string[]) => args.filter((a) => a.startsWith('-'));
const operands = (args: string[]) => args.filter((a) => !a.startsWith('-'));

function simpleIsSafe(words: string[], cwd: string, addDirs: string[]): boolean {
  const [prog, ...args] = words as [string, ...string[]];
  if (prog.includes('=') || prog.includes('/') || prog.includes('\\')) return false; // VAR=x cmd, or a program by path
  // a path argument anywhere must stay in the workspace; a pattern like "a/b" resolves inside it too, so it passes
  const outside = operands(args).some((a) => a.startsWith('~') || (/[\\/]|\.\./.test(a) && !isPathInsideRoots(cwd, a, addDirs)));
  if (outside) return false;

  if (READ_ONLY.has(prog)) {
    if (prog === 'sort') return !args.some((a) => a === '-o' || a.startsWith('--output') || /^-[a-zA-Z]*o/.test(a)); // sort -o writes a file
    if (prog === 'uniq') return operands(args).length <= 1; // a second operand is an output file
    if (prog === 'rg') return !args.some((a) => a.startsWith('--pre')); // --pre runs a program
    return true;
  }
  if (prog === 'find') return !args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)$/.test(a));
  if (FS_OPS.has(prog)) return true;
  if (DEV_TOOLS.has(prog)) return prog !== 'playwright' || args[0] === 'test';
  if (prog === 'npx') return args.length > 0 && DEV_TOOLS.has(args[0]!) && (args[0] !== 'playwright' || args[1] === 'test');
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(prog)) return args.length > 0 && PM_RUN.has(args[0]!);
  if (prog === 'git') {
    const sub = args[0];
    if (sub === 'branch') return flagsOf(args.slice(1)).every((f) => ['-a', '-r', '-v', '-vv', '--list', '--show-current'].includes(f)) && operands(args.slice(1)).length === 0;
    return sub !== undefined && GIT_READ.has(sub);
  }
  if (prog === 'node') return args.length === 1 && (args[0] === '--version' || args[0] === '-v');
  if (prog === 'cargo') return ['build', 'test', 'check', 'clippy', 'fmt'].includes(args[0] ?? '');
  if (prog === 'go') return ['build', 'test', 'vet', 'fmt'].includes(args[0] ?? '');
  if (prog === 'dotnet') return ['build', 'test'].includes(args[0] ?? '');
  if (prog === 'pytest') return true;
  if (prog === 'python' || prog === 'python3') return (args[0] === '-m' && ['pytest', 'unittest'].includes(args[1] ?? '')) || args[0] === '--version';
  return false;
}

export function isSafeCommand(command: string, cwd: string, addDirs: string[] = []): boolean {
  const c = command.trim();
  if (!c || c.length > 2000) return false;
  const parts = simpleCommands(c);
  return parts !== undefined && parts.every((p) => simpleIsSafe(p, cwd, addDirs));
}

/** The key a remembered "always allow" is stored under: bash is remembered per exact command, never as a blanket rule. */
export function ruleKey(tool: string, input: Record<string, unknown>): string {
  if (tool === 'bash') return `bash:${String(input.command ?? '')}`;
  if (tool === 'web_fetch' || tool === 'screenshot') return `${tool}:${hostOf(input.url)}`; // remembered per site
  return tool;
}

function hostOf(url: unknown): string {
  try { return new URL(String(url)).hostname; } catch { return ''; }
}

/** One place that decides what each permission mode means; the main agent and every subagent go through it. */
export function decide(
  mode: PermissionMode,
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
  addDirs: string[],
  remembered: ReadonlySet<string>,
): Verdict {
  if (mode === 'bypassPermissions') return { kind: 'allow' };
  // the subagent's own calls are decided here too; asking the user is not an action that needs approval
  // bash_output / bash_kill only touch commands that were already approved when they started
  if (SESSION_TOOLS.has(tool)) return { kind: 'allow' };

  const path = typeof input.path === 'string' && input.path ? input.path : '';
  const inside = path ? isPathInsideRoots(cwd, path, addDirs) : true;

  // a page on this machine (a dev server, a workspace HTML file) is just looked at; another site is asked about like web_fetch
  if (tool === 'screenshot' && screenshotTarget(String(input.url ?? ''), cwd, addDirs).kind !== 'remote') return { kind: 'allow' };

  if (READ_TOOLS.has(tool) && inside) return { kind: 'allow' };
  if (remembered.has(ruleKey(tool, input))) return { kind: 'allow' };

  if (mode === 'plan') {
    return READ_TOOLS.has(tool) || tool === 'web_fetch' || tool === 'screenshot' // researching is what plan mode is for; the user still approves each site
      ? { kind: 'ask' }
      : { kind: 'deny', message: 'Plan mode is read-only. Investigate with read tools, then call exit_plan with your plan for the user to approve.' };
  }
  if (mode === 'dontAsk') {
    return { kind: 'deny', message: `"${tool}" is not pre-approved and permissions are set to never ask. Use another approach or tell the user what you need.` };
  }
  if ((mode === 'acceptEdits' || mode === 'auto') && EDIT_TOOLS.has(tool) && inside) return { kind: 'allow' };
  if (mode === 'auto' && tool === 'bash' && isSafeCommand(String(input.command ?? ''), cwd, addDirs)) return { kind: 'allow' };
  return { kind: 'ask' };
}
