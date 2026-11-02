import type { PermissionMode } from '@ci/shared';
import { isPathInsideRoots } from './tools/read.ts';

export type Verdict = { kind: 'allow' } | { kind: 'ask' } | { kind: 'deny'; message: string };

const READ_TOOLS = new Set(['read_file', 'glob', 'grep', 'load_skill']);
const EDIT_TOOLS = new Set(['write_file', 'edit_file']);
const SESSION_TOOLS = new Set(['invoke_subagent', 'exit_plan', 'ask_user_question', 'TodoWrite', 'bash_output', 'bash_kill']);

// shortcut: a command is "safe" only if it is one of these read-only programs with no shell operators; widen when `auto` asks too often.
const SAFE_COMMAND = /^(git\s+(status|log|diff|show|branch|rev-parse|ls-files)|ls|dir|pwd|cat|head|tail|wc|echo|type|where|which|node\s+--version|npm\s+(test|run\s+(test|check|typecheck|lint|build))|npx\s+(tsc|vitest)|tsc|vitest)(\s|$)/;
const SHELL_OPERATORS = /[;&|<>`$()\n\r]/;

export function isSafeCommand(command: string): boolean {
  const c = command.trim();
  return SAFE_COMMAND.test(c) && !SHELL_OPERATORS.test(c);
}

/** The key a remembered "always allow" is stored under: bash is remembered per exact command, never as a blanket rule. */
export function ruleKey(tool: string, input: Record<string, unknown>): string {
  if (tool === 'bash') return `bash:${String(input.command ?? '')}`;
  if (tool === 'web_fetch') return `web_fetch:${hostOf(input.url)}`; // remembered per site
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

  if (READ_TOOLS.has(tool) && inside) return { kind: 'allow' };
  if (remembered.has(ruleKey(tool, input))) return { kind: 'allow' };

  if (mode === 'plan') {
    return READ_TOOLS.has(tool) || tool === 'web_fetch' // researching is what plan mode is for; the user still approves each site
      ? { kind: 'ask' }
      : { kind: 'deny', message: 'Plan mode is read-only. Investigate with read tools, then call exit_plan with your plan for the user to approve.' };
  }
  if (mode === 'dontAsk') {
    return { kind: 'deny', message: `"${tool}" is not pre-approved and permissions are set to never ask. Use another approach or tell the user what you need.` };
  }
  if ((mode === 'acceptEdits' || mode === 'auto') && EDIT_TOOLS.has(tool) && inside) return { kind: 'allow' };
  if (mode === 'auto' && tool === 'bash' && isSafeCommand(String(input.command ?? ''))) return { kind: 'allow' };
  return { kind: 'ask' };
}
