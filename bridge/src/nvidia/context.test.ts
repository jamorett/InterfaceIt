import { describe, expect, it } from 'vitest';
import type { OpenAiMessage } from './client.ts';
import { capToolResult, estimateTokens, shrinkOldToolResults, summaryCut } from './context.ts';

const big = 'x'.repeat(2000);
const exchange = (i: number): OpenAiMessage[] => [
  { role: 'user', content: `task ${i}` },
  { role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: `c${i}`, content: big },
  { role: 'assistant', content: `done ${i}` },
];
const convo = (n: number): OpenAiMessage[] => [{ role: 'system', content: 'sys' }, ...Array.from({ length: n }, (_, i) => exchange(i)).flat()];

describe('context management', () => {
  it('estimates roughly chars / 4', () => {
    expect(estimateTokens([{ role: 'user', content: 'a'.repeat(400) }])).toBe(100);
  });
  it('caps a huge tool result but keeps both ends', () => {
    const out = capToolResult('A'.repeat(20_000) + 'M'.repeat(50_000) + 'Z'.repeat(8_000));
    expect(out.length).toBeLessThan(30_500);
    expect(out.startsWith('A')).toBe(true);
    expect(out.endsWith('Z')).toBe(true);
    expect(out).toContain('omitted');
    expect(capToolResult('short')).toBe('short');
  });
  it('shrinks old tool output and leaves the recent messages alone', () => {
    const m = convo(6);
    const tail = m.slice(-8).map((x) => x.content);
    expect(shrinkOldToolResults(m)).toBeGreaterThan(0);
    expect(m.slice(-8).map((x) => x.content)).toEqual(tail);
    expect(m[3]!.content).toContain('omitted');
  });
  it('cuts the summary on a user message so no tool call is split from its answer', () => {
    const m = convo(6);
    const cut = summaryCut(m);
    expect(cut).toBeGreaterThan(1);
    expect(m[cut]!.role).toBe('user');
    expect(summaryCut(convo(1))).toBe(-1);
  });
});
