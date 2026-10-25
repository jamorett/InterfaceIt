import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '../model.ts';
import { findMatches, toMarkdown } from './transcriptText.ts';

const items: TranscriptItem[] = [
  { kind: 'user', id: 'u', text: 'Fix the Login bug' },
  { kind: 'tool', tool: { id: 't', name: 'Read', target: 'src/login.ts', status: 'ok', output: 'secret' } },
  { kind: 'assistant', id: 'a', text: 'Done.' },
  { kind: 'stopped', id: 's' },
];

describe('transcript text', () => {
  it('finds cards ignoring case, in order', () => {
    expect(findMatches(items, 'login')).toEqual([0, 1]);
    expect(findMatches(items, '  ')).toEqual([]);
  });
  it('exports the talk and the tool list, not the tool output', () => {
    const md = toMarkdown(items, 'Fix');
    expect(md).toContain('## You\n\nFix the Login bug');
    expect(md).toContain('- `Read` src/login.ts');
    expect(md).not.toContain('secret');
  });
});
