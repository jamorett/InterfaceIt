import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '../model.ts';
import { groupRows, waitingIndexes } from './Transcript.tsx';

const tool = (id: string, parentId?: string): TranscriptItem => ({ kind: 'tool', tool: { id, name: 'Read', target: id, status: 'ok', parentId } });
const perm: TranscriptItem = { kind: 'permission', view: { id: 'p', title: 't', target: '', requiresUserInteraction: true, canRemember: false } as never };

describe('groupRows', () => {
  it('draws an agent\'s calls inside its card, in order, and nested agents inside theirs', () => {
    const items = [tool('task'), tool('a', 'task'), tool('sub', 'task'), tool('b', 'sub'), tool('plain')];
    const { rows, childrenOf } = groupRows(items);
    expect(rows.map((r) => r.index)).toEqual([0, 4]); // only the agent's card and the plain call are rows
    expect(childrenOf.get('task')!.map((t) => t.id)).toEqual(['a', 'sub']);
    expect(childrenOf.get('sub')!.map((t) => t.id)).toEqual(['b']);
  });

  it('a call whose agent card is not in the list stays a row of its own', () => {
    const { rows } = groupRows([tool('orphan', 'gone')]);
    expect(rows).toHaveLength(1);
  });

  it('maps a position in the flat list to the row that shows it, so search and Alt+↑/↓ still land on it', () => {
    const items = [tool('x'), tool('task'), tool('a', 'task'), tool('b', 'a'), perm];
    const { rowFor } = groupRows(items);
    expect(rowFor(0)).toBe(0);
    expect(rowFor(2)).toBe(rowFor(1)); // a child is shown by its agent's row
    expect(rowFor(3)).toBe(rowFor(1)); // and a grandchild too
    expect(rowFor(4)).toBe(2); // rows are x, the agent's card, then the permission card
    expect(waitingIndexes(items)).toEqual([4]);
  });
});
