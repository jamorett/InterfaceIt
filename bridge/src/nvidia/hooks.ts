import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { killTree } from './tools/bash.ts';
import { resolveShell } from './tools/shellResolver.ts';

// shortcut: only PreToolUse and PostToolUse command hooks; UserPromptSubmit, Stop and the rest are not run. Add them here when a user's setup needs them.
type Event = 'PreToolUse' | 'PostToolUse';

interface HookEntry {
  matcher?: string;
  hooks?: { type?: string; command?: string; timeout?: number }[];
}

export interface HookOutcome {
  /** a hook said no (exit code 2, or a JSON "block"/"deny" answer) */
  blocked: boolean;
  /** what the hook wrote for the model: the reason when blocked, extra feedback otherwise */
  message?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The model's tools under the names Claude Code's hooks are written against. Unlisted tools run no hooks (except MCP ones). */
const CLAUDE_NAME: Record<string, string> = {
  read_file: 'Read', write_file: 'Write', edit_file: 'Edit', bash: 'Bash', glob: 'Glob', grep: 'Grep', web_fetch: 'WebFetch', invoke_subagent: 'Task', TodoWrite: 'TodoWrite',
};

/** The reverse of handoff.toNimCall: arguments shaped the way Claude's tools take them. */
export function toClaudeCall(name: string, input: Record<string, unknown>): { name: string; input: Record<string, unknown> } | undefined {
  const claude = CLAUDE_NAME[name] ?? (name.startsWith('mcp__') ? name : undefined);
  if (!claude) return undefined;
  const i = { ...input };
  if (typeof i.path === 'string' && (name === 'read_file' || name === 'write_file' || name === 'edit_file')) { i.file_path = i.path; delete i.path; }
  if (name === 'grep' && typeof i.query === 'string') { i.pattern = i.query; delete i.query; }
  if (name === 'read_file') {
    if (i.startLine !== undefined) { i.offset = i.startLine; delete i.startLine; }
    if (i.endLine !== undefined) delete i.endLine;
  }
  if (name === 'bash' && i.timeoutMs !== undefined) { i.timeout = i.timeoutMs; delete i.timeoutMs; }
  return { name: claude, input: i };
}

export function loadHooks(cwd: string): Record<Event, HookEntry[]> {
  const out: Record<Event, HookEntry[]> = { PreToolUse: [], PostToolUse: [] };
  const files = [join(homedir(), '.claude', 'settings.json'), join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const hooks = (JSON.parse(readFileSync(file, 'utf-8')) as { hooks?: unknown }).hooks;
      if (!isRecord(hooks)) continue;
      for (const ev of ['PreToolUse', 'PostToolUse'] as const) if (Array.isArray(hooks[ev])) out[ev].push(...(hooks[ev] as HookEntry[]));
    } catch { /* unreadable settings: no hooks from this file */ }
  }
  return out;
}

const matches = (matcher: string | undefined, tool: string): boolean => {
  if (!matcher || matcher === '*') return true;
  try { return new RegExp(`^(?:${matcher})$`).test(tool); } catch { return matcher === tool; }
};

export class Hooks {
  private hooks: Record<Event, HookEntry[]>;

  constructor(private cwd: string, private sessionId: string, hooks?: Record<Event, HookEntry[]>) {
    this.hooks = hooks ?? loadHooks(cwd);
  }

  get any(): boolean {
    return this.hooks.PreToolUse.length + this.hooks.PostToolUse.length > 0;
  }

  async run(event: Event, tool: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<HookOutcome> {
    const call = toClaudeCall(tool, input);
    if (!call) return { blocked: false };
    const commands = this.hooks[event]
      .filter((e) => matches(e.matcher, call.name))
      .flatMap((e) => e.hooks ?? [])
      .filter((h) => (h.type ?? 'command') === 'command' && h.command);
    const notes: string[] = [];
    for (const h of commands) {
      const r = await this.exec(h.command!, (h.timeout ?? 60) * 1000, { session_id: this.sessionId, cwd: this.cwd, hook_event_name: event, tool_name: call.name, tool_input: call.input, ...extra }, signal);
      if (r.blocked) return { blocked: true, message: r.message };
      if (r.message) notes.push(r.message);
    }
    return { blocked: false, message: notes.join('\n') || undefined };
  }

  private exec(command: string, timeoutMs: number, payload: object, signal?: AbortSignal): Promise<HookOutcome> {
    return new Promise((resolve) => {
      const shell = resolveShell();
      const proc = spawn(shell.path, shell.buildArgs(command), { cwd: this.cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: this.cwd }, windowsHide: true });
      let out = '';
      let err = '';
      let settled = false;
      const finish = (o: HookOutcome) => { if (!settled) { settled = true; clearTimeout(timer); resolve(o); } };
      const timer = setTimeout(() => { killTree(proc); finish({ blocked: false, message: `Hook timed out after ${timeoutMs / 1000}s: ${command}` }); }, timeoutMs);
      signal?.addEventListener('abort', () => { killTree(proc); finish({ blocked: false }); }, { once: true });
      proc.stdout?.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
      proc.stderr?.on('data', (d: Buffer) => { err += d.toString('utf-8'); });
      proc.on('error', (e) => finish({ blocked: false, message: `Hook failed to start: ${e.message}` }));
      proc.on('close', (code) => {
        if (code === 2) return finish({ blocked: true, message: err.trim() || 'Blocked by a hook.' });
        // the JSON form: {"decision":"block","reason":"…"} or hookSpecificOutput.permissionDecision = "deny"
        try {
          const j = JSON.parse(out) as { decision?: string; reason?: string; hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
          if (j.decision === 'block' || j.decision === 'deny') return finish({ blocked: true, message: j.reason || 'Blocked by a hook.' });
          if (j.hookSpecificOutput?.permissionDecision === 'deny') return finish({ blocked: true, message: j.hookSpecificOutput.permissionDecisionReason || 'Blocked by a hook.' });
        } catch { /* plain text output */ }
        finish({ blocked: false });
      });
      proc.stdin?.on('error', () => undefined); // the hook may exit without reading its input
      proc.stdin?.end(JSON.stringify(payload));
    });
  }
}
