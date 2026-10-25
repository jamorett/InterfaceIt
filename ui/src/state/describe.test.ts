import { describe, expect, it } from 'vitest';
import { basename, describeTool, diffFor, todosFrom } from './describe.ts';

describe('describeTool', () => {
  it.each([
    ['Bash', { command: 'npm test', description: 'x' }, 'npm test'],
    ['Read', { file_path: 'C:\\a\\b.ts' }, 'C:\\a\\b.ts'],
    ['Grep', { pattern: 'TODO', path: '.' }, 'TODO'],
    ['WebFetch', { url: 'https://x.dev', prompt: 'p' }, 'https://x.dev'],
    ['Agent', { description: 'Compute 2+2', prompt: 'long' }, 'Compute 2+2'],
    ['ToolSearch', { query: 'select:TodoWrite' }, 'select:TodoWrite'],
  ])('%s shows its main field', (name, input, shown) => {
    expect(describeTool(name, input)).toBe(shown);
  });

  it('shows something sensible for a tool it has never heard of', () => {
    expect(describeTool('BrandNewTool', { zzz: 5, label: 'hello' })).toBe('hello');
    expect(describeTool('BrandNewTool', { n: 1, deep: { a: 1 } })).toBe('{"n":1,"deep":{"a":1}}');
    expect(describeTool('BrandNewTool', {})).toBe('');
    expect(describeTool('BrandNewTool', 'not an object')).toBe('');
    expect(describeTool('Bash', null)).toBe('');
  });

  it('cuts very long JSON', () => {
    expect(describeTool('X', { list: ['y'.repeat(300)] }).length).toBeLessThanOrEqual(120);
  });
});

describe('diffFor', () => {
  it('shows an edit as removed then added lines', () => {
    expect(diffFor('Edit', { old_string: 'hello', new_string: 'goodbye\nworld' })).toEqual([
      { kind: 'del', text: 'hello' }, { kind: 'add', text: 'goodbye' }, { kind: 'add', text: 'world' },
    ]);
  });
  it('shows a new file as added lines and cuts a long one', () => {
    const d = diffFor('Write', { content: Array.from({ length: 100 }, (_, i) => `l${i}`).join('\r\n') })!;
    expect(d).toHaveLength(41);
    expect(d.at(-1)).toEqual({ kind: 'ctx', text: '… 60 more lines' });
    expect(d[0]).toEqual({ kind: 'add', text: 'l0' });
  });
  it('has nothing to show for other tools or malformed input', () => {
    expect(diffFor('Bash', { command: 'ls' })).toBeUndefined();
    expect(diffFor('Edit', { old_string: 1 })).toBeUndefined();
    expect(diffFor('Edit', { old_string: '', new_string: 'x' })).toEqual([{ kind: 'add', text: 'x' }]);
  });
});

describe('todosFrom', () => {
  const none = [{ content: 'old', activeForm: 'olding', status: 'pending' as const }];
  it('replaces the list from TodoWrite', () => {
    expect(todosFrom('TodoWrite', { todos: [{ content: 'a', activeForm: 'doing a', status: 'in_progress' }, { content: 'b', status: 'weird' }] }, none)).toEqual([
      { content: 'a', activeForm: 'doing a', status: 'in_progress' }, { content: 'b', activeForm: 'b', status: 'pending' },
    ]);
  });
  it('leaves the list alone for every other tool and for bad input', () => {
    expect(todosFrom('Bash', { todos: [] }, none)).toBe(none);
    expect(todosFrom('TodoWrite', { todos: 'nope' }, none)).toBe(none);
    expect(todosFrom('TodoWrite', null, none)).toBe(none);
  });
});

describe('basename', () => {
  it('takes the last folder of either kind of path', () => {
    expect([basename('C:\\Users\\me\\proj'), basename('/home/me/proj/'), basename('proj'), basename('')]).toEqual(['proj', 'proj', 'proj', '']);
  });
});
