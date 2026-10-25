import type { DiffLine, TodoItem } from '../model.ts';

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const firstString = (o: Record<string, unknown>, ...keys: string[]) => keys.map((k) => o[k]).find((v): v is string => typeof v === 'string' && v.length > 0);

/**
 * The one-line "what is this tool doing" on a card. The names below only choose which field to show: a tool this
 * code has never heard of gets its first text field or compact JSON, so a new tool never needs UI code to appear.
 */
export function describeTool(name: string, input: unknown): string {
  if (!isRecord(input)) return '';
  switch (name) {
    case 'Bash': case 'PowerShell': return firstString(input, 'command') ?? '';
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return firstString(input, 'file_path', 'notebook_path') ?? '';
    case 'Grep': case 'Glob': return firstString(input, 'pattern') ?? '';
    case 'WebFetch': return firstString(input, 'url') ?? '';
    case 'WebSearch': case 'ToolSearch': return firstString(input, 'query') ?? '';
    case 'Agent': case 'Task': return firstString(input, 'description') ?? '';
  }
  const text = Object.values(input).find((v): v is string => typeof v === 'string' && v.length > 0);
  if (text) return text;
  const json = JSON.stringify(input);
  return json === '{}' ? '' : json.length > 120 ? `${json.slice(0, 119)}…` : json;
}

const LIMIT = 40;
const lines = (s: string) => (s === '' ? [] : s.replace(/\r\n/g, '\n').split('\n'));

/** A preview of what Edit/Write would change, from the request itself (a real side-by-side diff comes with M4). */
export function diffFor(tool: string, input: Record<string, unknown>): DiffLine[] | undefined {
  const cut = (arr: string[], kind: 'add' | 'del'): DiffLine[] => [
    ...arr.slice(0, LIMIT).map((text) => ({ kind, text })),
    ...(arr.length > LIMIT ? [{ kind: 'ctx' as const, text: `… ${arr.length - LIMIT} more lines` }] : []),
  ];
  if (tool === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return [...cut(lines(input.old_string), 'del'), ...cut(lines(input.new_string), 'add')];
  }
  if (tool === 'Write' && typeof input.content === 'string') return cut(lines(input.content), 'add');
  return undefined;
}

/** Only TodoWrite is wired (no todo tool exists in SDK sessions of CLI 2.1.310, PLAN.md §13.2); anything else leaves the list as it was. */
export function todosFrom(name: string, input: unknown, current: TodoItem[]): TodoItem[] {
  if (name !== 'TodoWrite' || !isRecord(input) || !Array.isArray(input.todos)) return current;
  return input.todos.filter(isRecord).map((t) => ({
    content: String(t.content ?? ''),
    activeForm: String(t.activeForm ?? t.content ?? ''),
    status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
  }));
}

export function basename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
