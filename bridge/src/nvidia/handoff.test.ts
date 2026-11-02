import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@ci/shared';
import { eventsToOpenAiMessages, toNimCall } from './handoff.ts';

describe('handoff from Claude', () => {
  it('renames Claude tools and arguments to the NIM ones', () => {
    expect(toNimCall('Read', { file_path: 'a.ts', offset: 10, limit: 5 })).toEqual({ name: 'read_file', input: { path: 'a.ts', startLine: 10, endLine: 14 } });
    expect(toNimCall('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }).name).toBe('edit_file');
    expect(toNimCall('Grep', { pattern: 'foo.*', path: 'src' })).toEqual({ name: 'grep', input: { query: 'foo.*', is_regex: true, path: 'src' } });
    expect(toNimCall('Bash', { command: 'ls', timeout: 5000 }).input).toEqual({ command: 'ls', timeoutMs: 5000 });
    expect(toNimCall('Task', { x: 1 })).toEqual({ name: 'Task', input: { x: 1 } });
  });

  it('puts the renamed call and its answer into the messages', () => {
    const ev = (e: object) => ({ seq: 0, ts: 0, ...e }) as unknown as SessionEvent;
    const m = eventsToOpenAiMessages(
      [
        ev({ type: 'user_message', id: 'u', text: 'read it' }),
        ev({ type: 'tool_start', id: 't1', name: 'Read' }),
        ev({ type: 'tool_input', id: 't1', input: { file_path: 'a.ts' } }),
        ev({ type: 'tool_end', id: 't1', result: { text: 'hello', images: 0 }, isError: false }),
      ],
      'sys',
    );
    expect(m[2]?.tool_calls?.[0]?.function).toEqual({ name: 'read_file', arguments: '{"path":"a.ts"}' });
    expect(m[3]).toMatchObject({ role: 'tool', tool_call_id: 't1', content: 'hello' });
  });
});
