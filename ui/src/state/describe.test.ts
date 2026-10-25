import { describe, expect, it } from 'vitest';
import { basename, describeTool, diffFor, readPreview, todosFrom } from './describe.ts';

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
      { kind: 'del', text: 'hello', oldNo: 1 }, { kind: 'add', text: 'goodbye', newNo: 1 }, { kind: 'add', text: 'world', newNo: 2 },
    ]);
  });
  it('shows a new file as added lines and cuts a long one', () => {
    const d = diffFor('Write', { content: Array.from({ length: 100 }, (_, i) => `l${i}`).join('\r\n') })!;
    expect(d).toHaveLength(41);
    expect(d.at(-1)).toEqual({ kind: 'ctx', text: '… 60 more lines', fold: true });
    expect(d[0]).toEqual({ kind: 'add', text: 'l0', newNo: 1 });
  });
  it('shows an edit that changes one line of a block as one change, with the neighbours as context', () => {
    const d = diffFor('Edit', { old_string: 'a\nb\nc', new_string: 'a\nB\nc' })!;
    expect(d.map((l) => l.kind)).toEqual(['ctx', 'del', 'add', 'ctx']);
  });
  it('shows a MultiEdit as its edits one after the other', () => {
    const d = diffFor('MultiEdit', { edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: 'q' }, { nope: 1 }] })!;
    expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual(['del:x', 'add:y', 'ctx:edit 2', 'del:p', 'add:q']);
  });
  it('has nothing to show for other tools or malformed input', () => {
    expect(diffFor('Bash', { command: 'ls' })).toBeUndefined();
    expect(diffFor('Edit', { old_string: 1 })).toBeUndefined();
    expect(diffFor('Edit', { old_string: '', new_string: 'x' })).toEqual([{ kind: 'add', text: 'x', newNo: 1 }]);
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

describe('readPreview', () => {
  const out = '     1→import a from "a";\n     2→\n     3→export const b = 1;\n';
  it('moves the line numbers out of the text and picks the language from the file name, on either kind of path', () => {
    expect(readPreview(out, 'C:\\proj\\src\\x.ts')).toEqual({ code: 'import a from "a";\n\nexport const b = 1;', language: 'ts', firstLine: 1 });
    expect(readPreview(out, '/home/me/x.py')?.language).toBe('py');
    expect(readPreview(out, 'Makefile')?.language).toBeUndefined();
  });
  it('knows where a partial read starts', () => {
    expect(readPreview('   120\tfoo\n   121\tbar', 'a.js')).toMatchObject({ firstLine: 120, code: 'foo\nbar' });
  });
  it('leaves anything else alone', () => {
    expect(readPreview('just some text\nwithout numbers', 'a.ts')).toBeUndefined();
    expect(readPreview('', 'a.ts')).toBeUndefined();
    expect(readPreview('1→ok\nbut this line is not numbered', 'a.ts')).toBeUndefined();
  });
});

describe('basename', () => {
  it('takes the last folder of either kind of path', () => {
    expect([basename('C:\\Users\\me\\proj'), basename('/home/me/proj/'), basename('proj'), basename('')]).toEqual(['proj', 'proj', 'proj', '']);
  });
});
