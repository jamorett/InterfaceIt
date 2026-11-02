import { describe, expect, it } from 'vitest';
import { Hooks, toClaudeCall } from './hooks.ts';

const hook = (matcher: string, command: string) => ({ matcher, hooks: [{ type: 'command', command }] });
const make = (pre: ReturnType<typeof hook>[], post: ReturnType<typeof hook>[] = []) => new Hooks(process.cwd(), 's1', { PreToolUse: pre, PostToolUse: post });
// node -e works the same in Git Bash and in PowerShell
const nodeExit = (code: number, msg = '') => `node -e "console.error('${msg}');process.exit(${code})"`;

describe('hooks', () => {
  it('translates the model\'s tool and arguments to the names hooks are written for', () => {
    expect(toClaudeCall('edit_file', { path: 'a.ts', old_string: 'x', new_string: 'y' })).toEqual({ name: 'Edit', input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } });
    expect(toClaudeCall('grep', { query: 'foo' })).toEqual({ name: 'Grep', input: { pattern: 'foo' } });
    expect(toClaudeCall('mcp__srv__do', { a: 1 })?.name).toBe('mcp__srv__do');
    expect(toClaudeCall('bash_output', {})).toBeUndefined();
  });

  it('exit code 2 blocks and hands the hook\'s message back', async () => {
    const r = await make([hook('Bash', nodeExit(2, 'no rm allowed'))]).run('PreToolUse', 'bash', { command: 'rm x' });
    expect(r).toEqual({ blocked: true, message: 'no rm allowed' });
  }, 20_000);

  it('only runs for matching tools; other exit codes do not block', async () => {
    const h = make([hook('Edit|Write', nodeExit(2, 'nope')), hook('Bash', nodeExit(1, 'warn'))]);
    expect((await h.run('PreToolUse', 'read_file', { path: 'a' })).blocked).toBe(false);
    expect((await h.run('PreToolUse', 'bash', { command: 'ls' })).blocked).toBe(false);
    expect((await h.run('PreToolUse', 'write_file', { path: 'a', content: '' })).blocked).toBe(true);
  }, 30_000);

  it('the hook receives the call as JSON on stdin', async () => {
    const script = `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.exit(j.tool_name==='Bash'&&j.tool_input.command==='ls'&&j.hook_event_name==='PreToolUse'?2:0)})"`;
    expect((await make([hook('*', script)]).run('PreToolUse', 'bash', { command: 'ls' })).blocked).toBe(true);
    expect((await make([hook('*', script)]).run('PreToolUse', 'bash', { command: 'pwd' })).blocked).toBe(false);
  }, 30_000);

  it('a JSON "deny" answer blocks too', async () => {
    const cmd = `node -e "console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'policy'}}))"`;
    expect(await make([hook('*', cmd)]).run('PreToolUse', 'write_file', { path: 'a', content: '' })).toEqual({ blocked: true, message: 'policy' });
  }, 20_000);
});
