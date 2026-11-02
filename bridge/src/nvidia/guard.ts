import { resolve } from 'node:path';
import { resolveSafePath } from './tools/read.ts';

// Guardrails for how the agents work together. A prompt asks the model to behave; these make the harness hold the line when it does not.

const norm = (p: string) => {
  const abs = resolve(p).replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
};
const covers = (owner: string, file: string) => file === owner || file.startsWith(`${owner}/`);

/** The files or folders an agent was given, as absolute normalised paths. */
export function ownedPaths(files: unknown, cwd: string): string[] {
  return (Array.isArray(files) ? files : []).filter((f): f is string => typeof f === 'string' && f.trim() !== '').map((f) => norm(resolveSafePath(cwd, f.trim())));
}

export function isOwned(file: string, owned: string[], cwd: string): boolean {
  const f = norm(resolveSafePath(cwd, file));
  return owned.some((o) => covers(o, f));
}

/** scratch space every agent may use for throwaway test files: .tmp/ inside the workspace */
const isScratch = (file: string, cwd: string) => covers(norm(resolve(cwd, '.tmp')), norm(resolveSafePath(cwd, file)));

/**
 * A batch of agents started together must not be able to collide: every agent names the files only it may change, and no two agents
 * share one. Returns what to tell the lead when that is not so (the whole batch is then not run), or nothing.
 */
export function validateBatch(requests: { role: string; files?: unknown; check?: unknown }[], cwd: string): string | undefined {
  if (requests.length < 2) return undefined;
  const owned = requests.map((r) => ownedPaths(r.files, cwd));
  const missing = requests.filter((_, i) => owned[i]!.length === 0).map((r) => `"${r.role}"`);
  if (missing.length) {
    return `Batch not run. When you start several agents at once, each one needs "files": the files or folders only that agent may create or change, different for every agent. Missing for: ${missing.join(', ')}. Split the work so that each agent owns different files, keep anything shared (an entry point, the HTML skeleton, a config file) for yourself and integrate it after they return, then send the batch again.`;
  }
  const noCheck = requests.filter((r) => typeof r.check !== 'string' || !r.check.trim()).map((r) => `"${r.role}"`);
  if (noCheck.length) {
    return `Batch not run. Each agent needs "check": the command that proves its part works before it reports (for example node data.test.js, or a screenshot test page for a drawing module). Missing for: ${noCheck.join(', ')}. Decide how each part will be verified, then send the batch again.`;
  }
  for (let i = 0; i < requests.length; i++) {
    for (let j = i + 1; j < requests.length; j++) {
      const clash = owned[i]!.find((a) => owned[j]!.some((b) => covers(a, b) || covers(b, a)));
      if (clash) return `Batch not run. Agents "${requests[i]!.role}" and "${requests[j]!.role}" both own ${clash.split('/').slice(-2).join('/')}. Two agents must never write the same file. Give it to one of them, or keep it yourself and integrate it after they return, then send the batch again.`;
    }
  }
  return undefined;
}

/**
 * Who has written what during one batch. An agent that was given `files` may only write inside them; whatever it writes, the
 * first writer keeps the file and any other agent is refused. The message says what to do instead of leaving it guessing.
 */
export class BatchClaims {
  private owner = new Map<string, string>();

  reset(): void {
    this.owner.clear();
  }

  /** undefined = go ahead; otherwise the refusal to give the agent as the tool result */
  write(agent: string, file: string, owned: string[], cwd: string): string | undefined {
    if (isScratch(file, cwd)) return undefined; // throwaway test files are nobody's
    const f = norm(resolveSafePath(cwd, file));
    if (owned.length > 0 && !owned.some((o) => covers(o, f))) {
      return `Refused: ${file} is not one of your files. You may only change: ${owned.map((o) => o.split('/').slice(-2).join('/')).join(', ')}. If your work needs a change there, do not make it: finish what you own and say in your report exactly what change is needed and why, so the lead can make it.`;
    }
    const other = this.owner.get(f);
    if (other && other !== agent) {
      return `Refused: ${file} is being changed by another agent (${other}). Two agents must not write the same file. Leave it, finish the rest of your task, and say in your report what you needed to change there.`;
    }
    this.owner.set(f, agent);
    return undefined;
  }
}

/** The same call failing again and again is a loop, not progress: the second time is warned about and the third is not run. */
export class FailureTracker {
  private fails = new Map<string, number>();

  private key(tool: string, args: unknown) {
    return `${tool}:${JSON.stringify(args).slice(0, 800)}`;
  }

  /** before running a call: a refusal text if this exact call already failed twice */
  before(tool: string, args: unknown): string | undefined {
    const n = this.fails.get(this.key(tool, args)) ?? 0;
    return n >= 2
      ? `Blocked: you have sent this exact ${tool} call ${n} times and it failed every time, so it was not run again. Do not repeat it. Read the error, change something (the arguments, the file, the approach), or tell the user you are stuck and why.`
      : undefined;
  }

  /** after running it: text to append to the result when it failed again */
  after(tool: string, args: unknown, isError: boolean): string | undefined {
    const k = this.key(tool, args);
    if (!isError) { this.fails.delete(k); return undefined; }
    const n = (this.fails.get(k) ?? 0) + 1;
    this.fails.set(k, n);
    return n === 2 ? '\n[This exact call has now failed twice. Change your approach before trying again.]' : undefined;
  }
}

const CODE = /\.(tsx?|jsx?|mjs|cjs|py|rs|go|java|cs|css|scss|html?|vue|svelte|c|cc|cpp|h|hpp|rb|php|sh|ps1)$/i;
const UI = /\.(html?|css|scss|tsx|jsx|vue|svelte)$/i;
const SCRATCH = /(^|[\\/])\.(tmp|claude)[\\/]/;
// commands that run, build or test the work (a failing one counts: it was run)
const CHECK = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|check|typecheck)\b|\b(tsc|vitest|jest|mocha|pytest|eslint|vite\s+build|cargo\s+(test|check|build)|go\s+(test|build|vet)|dotnet\s+(test|build))\b|\bnode\s+\S+|\bpython3?\s+\S+/i;

/**
 * What the lead did in this turn about checking its work. When it is about to finish with code that was changed after the last check
 * (or UI that was changed after it last looked at it), the harness sends it back once, because "done" without a run is the failure
 * seen in practice: parts that each pass alone and do not fit together.
 */
export class TurnEvidence {
  private seq = 0;
  private lastChange = 0;
  private lastCheck = 0;
  private lastLook = 0;
  private reminded = false;
  readonly changed = new Set<string>();

  noteChanged(files: string[]): void {
    const code = files.filter((f) => CODE.test(f) && !SCRATCH.test(f));
    if (!code.length) return;
    code.forEach((f) => this.changed.add(f));
    this.lastChange = ++this.seq;
  }

  noteCommand(command: string): void {
    if (CHECK.test(command)) this.lastCheck = ++this.seq;
  }

  /** a screenshot was taken: it also runs the page */
  noteLook(): void {
    this.lastLook = this.lastCheck = ++this.seq;
  }

  /** the one reminder for this turn, or nothing */
  reminder(): string | undefined {
    if (this.reminded || this.lastChange === 0) return undefined;
    const unchecked = this.lastCheck < this.lastChange;
    const ui = [...this.changed].some((f) => UI.test(f));
    const unseen = ui && this.lastLook < this.lastChange;
    if (!unchecked && !unseen) return undefined;
    this.reminded = true;
    const files = [...this.changed].slice(0, 6).map((f) => f.replaceAll('\\', '/').split('/').pop()).join(', ');
    return `[Harness reminder, not from the user] You are about to finish, but you changed code (${files}${this.changed.size > 6 ? ', …' : ''}) and ${unchecked ? 'have not run, built or tested it since the last change' : 'have not looked at the page in a browser since the last change'}. The message you just wrote was shown to the user as if the work were finished. Check it now: ${unchecked ? 'run the build, the tests or the program' : ''}${unchecked && ui ? ', and ' : ''}${ui ? 'open it with the screenshot tool (normal width and about 420 for a phone), operate it with its actions and read the results, and compare them with what they must be' : ''}. Fix what you find. Then write your final answer and say exactly what you verified and how. If something could not be verified, say so plainly.`;
  }
}

/**
 * True when a shell command starts a background process with a lone "&" (outside quotes; "&&", ">&2", "2>&1" and "&>file" are not it).
 * Such a process is not tracked, keeps running after the session and holds the folder: the tool that starts and stops them is
 * run_in_background.
 */
export function startsBackgroundProcess(command: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c !== '&') continue;
    const next = command[i + 1];
    if (next === '&') { i++; continue; }
    if (next === '>' || command[i - 1] === '>' || command[i - 1] === '<') continue;
    return true;
  }
  return false;
}

export const BACKGROUND_REFUSAL = 'Do not start a background process with "&": it is not tracked and keeps running after this session. Call the bash tool again with run_in_background: true (then read it with bash_output and stop it with bash_kill).';
