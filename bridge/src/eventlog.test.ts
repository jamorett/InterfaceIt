import { describe, expect, it } from 'vitest';
import { EventLog, forWire, MAX_RESULT_CHARS } from './eventlog.ts';

describe('EventLog', () => {
  it('numbers events from 1 and stamps session and time', () => {
    const log = new EventLog('s1', () => 1000);
    const a = log.append({ type: 'commands_changed' });
    const b = log.append({ type: 'conversation_reset' });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(a).toMatchObject({ sessionId: 's1', ts: 1000 });
  });

  it('replays everything after a given seq (reconnect)', () => {
    const log = new EventLog('s1');
    for (let i = 0; i < 5; i++) log.append({ type: 'commands_changed' });
    expect(log.after(0)).toHaveLength(5);
    expect(log.after(3).map((e) => e.seq)).toEqual([4, 5]);
    expect(log.after(5)).toEqual([]);
    expect(log.after(99)).toEqual([]);
    expect(log.lastSeq).toBe(5);
  });

  it('marks events built from stored history', () => {
    expect(new EventLog('s').append({ type: 'conversation_reset' }, { replayed: true }).replayed).toBe(true);
  });

  it('keeps the full tool output while the wire copy is cut', () => {
    const log = new EventLog('s');
    const big = 'x'.repeat(MAX_RESULT_CHARS + 500);
    const e = log.append({ type: 'tool_end', id: 't1', result: { text: big, images: 0 }, isError: false });
    const wire = forWire(e);
    expect(wire.type === 'tool_end' && wire.result.text).toHaveLength(MAX_RESULT_CHARS);
    expect(wire.type === 'tool_end' && wire.result).toMatchObject({ truncated: true, bytes: MAX_RESULT_CHARS + 500 });
    expect(log.fullResult('t1')).toHaveLength(MAX_RESULT_CHARS + 500);
    expect(e.type === 'tool_end' && e.result.truncated).toBeUndefined(); // the log itself is untouched
  });

  it('leaves normal events alone and cuts huge tool inputs (a 1 MB Write)', () => {
    const log = new EventLog('s');
    const small = log.append({ type: 'tool_end', id: 't', result: { text: 'ok', images: 0 }, isError: false });
    expect(forWire(small)).toBe(small);
    const input = log.append({ type: 'tool_input', id: 'w', input: { file_path: 'a.txt', content: 'y'.repeat(500_000) } });
    const wire = forWire(input);
    expect(wire.type === 'tool_input' && JSON.stringify(wire.input).length).toBeLessThan(80_000);
    expect(wire.type === 'tool_input' && (wire.input as { file_path: string }).file_path).toBe('a.txt');
  });
});
