import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { killTree } from './bash.ts';
import { resolveShell } from './shellResolver.ts';

interface Job {
  command: string;
  proc: ChildProcess;
  /** output the model has not read yet */
  unread: string;
  exitCode: number | null | undefined; // undefined while it runs
}

const MAX_UNREAD = 100_000;
const MAX_JOBS = 8;

/** Long-running commands (dev servers, watchers, slow test runs) the model can start, poll and stop. They die with the session. */
export class BackgroundJobs {
  private jobs = new Map<string, Job>();

  start(command: string, cwd: string): { id: string } | { error: string } {
    if ([...this.jobs.values()].filter((j) => j.exitCode === undefined).length >= MAX_JOBS) return { error: `Too many background commands running (${MAX_JOBS}). Stop one with bash_kill first.` };
    const shell = resolveShell();
    const proc = spawn(shell.path, shell.buildArgs(command), { cwd, env: { ...process.env, CI: 'true', TERM: 'dumb', FORCE_COLOR: '0' }, windowsHide: true });
    const job: Job = { command, proc, unread: '', exitCode: undefined };
    const add = (d: Buffer) => {
      job.unread += d.toString('utf-8');
      if (job.unread.length > MAX_UNREAD) job.unread = `[… older output dropped …]\n${job.unread.slice(-MAX_UNREAD)}`;
    };
    proc.stdout?.on('data', add);
    proc.stderr?.on('data', add);
    proc.on('error', (e) => { job.unread += `\n[failed to start: ${e.message}]`; job.exitCode = -1; });
    proc.on('close', (code) => { job.exitCode = code; });
    const id = `bg_${randomBytes(3).toString('hex')}`;
    this.jobs.set(id, job);
    return { id };
  }

  /** New output since the last read, and whether the command is still running. */
  read(id: string): { text: string; running: boolean; exitCode?: number | null } | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const text = job.unread;
    job.unread = '';
    return { text, running: job.exitCode === undefined, exitCode: job.exitCode };
  }

  kill(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.exitCode === undefined) killTree(job.proc);
    return true;
  }

  killAll(): void {
    for (const job of this.jobs.values()) if (job.exitCode === undefined) killTree(job.proc);
  }
}
