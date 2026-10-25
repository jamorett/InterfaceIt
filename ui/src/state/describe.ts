import type { DiffLine, TodoItem } from '../model.ts';
import { lineDiff } from './diff.ts';

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
export function diffFor(tool: string, input: Record<string, unknown>, limit = LIMIT): DiffLine[] | undefined {
  if (tool === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    return lineDiff(input.old_string, input.new_string, 2);
  }
  if (tool === 'Write' && typeof input.content === 'string') {
    const all = lines(input.content);
    return [
      ...all.slice(0, limit).map((text, i): DiffLine => ({ kind: 'add', text, newNo: i + 1 })),
      ...(all.length > limit ? [{ kind: 'ctx' as const, text: `… ${all.length - limit} more lines`, fold: true }] : []),
    ];
  }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    // several edits to one file: each is shown in turn, the way the tool applies them
    const parts = input.edits.filter(isRecord).flatMap((e) => (typeof e.old_string === 'string' && typeof e.new_string === 'string' ? [lineDiff(e.old_string, e.new_string, 2)] : []));
    return parts.length ? parts.flatMap((p, i) => (i ? [{ kind: 'ctx' as const, text: `edit ${i + 1}`, fold: true }, ...p] : p)) : undefined;
  }
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

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', json: 'json', md: 'md', py: 'py', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  css: 'css', scss: 'scss', html: 'html', htm: 'html', xml: 'xml', yml: 'yaml', yaml: 'yaml', toml: 'toml', sh: 'sh', bash: 'sh', ps1: 'powershell',
  sql: 'sql', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', vue: 'vue', svelte: 'svelte', dockerfile: 'docker',
};

/**
 * A Read result is "   12→text" per line. As a preview, the numbers move out of the text so it can be coloured as code
 * (and copied without them). Anything that does not look like that is shown as it is.
 */
export function readPreview(output: string, path: string): { code: string; language?: string; firstLine: number } | undefined {
  const lines = output.replace(/\r\n/g, '\n').split('\n');
  const numbered = lines.filter((l) => l.trim() !== '');
  const prefix = /^\s*(\d+)[→\t](.*)$/;
  if (!numbered.length || !numbered.every((l) => prefix.test(l))) return undefined;
  const code = lines.map((l) => prefix.exec(l)?.[2] ?? '').join('\n').replace(/\n+$/, '');
  const ext = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
  return { code, language: ext ? LANGUAGE_BY_EXTENSION[ext] : undefined, firstLine: Number(prefix.exec(numbered[0]!)![1]) };
}

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A data: URL for a picture a tool returned, or nothing if it is not a plain image type with base64 data. Nothing else may ever become a src. */
export function imageSrc(im: { mediaType: string; data: string }): string | undefined {
  return IMAGE_TYPES.test(im.mediaType) && im.data.length > 0 && BASE64.test(im.data) ? `data:${im.mediaType};base64,${im.data}` : undefined;
}
