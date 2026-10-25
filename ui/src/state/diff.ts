import type { DiffLine } from '../model.ts';

const LIMIT = 1500; // lines per side: the comparison grid is limited × limited

const split = (s: string) => (s === '' ? [] : s.replace(/\r\n/g, '\n').split('\n'));

/**
 * What changed between two texts, line by line, with a few unchanged lines around each change and the
 * rest folded away. Uses the longest common subsequence, so an Edit that touches two lines of a ten-line
 * block shows two changes, not ten removals and ten additions.
 */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
  const a = split(before);
  const b = split(after);
  if (a.length > LIMIT || b.length > LIMIT) {
    // too big to compare cheaply: show it as one removal and one addition
    return [...a.map((text, i): DiffLine => ({ kind: 'del', text, oldNo: i + 1 })), ...b.map((text, i): DiffLine => ({ kind: 'add', text, newNo: i + 1 }))];
  }
  // lengths[i][j] = length of the longest common run of a[i..] and b[j..]
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const all: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) all.push({ kind: 'ctx', text: a[i]!, oldNo: ++i, newNo: ++j });
    else if (i < a.length && (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) all.push({ kind: 'del', text: a[i]!, oldNo: ++i }); // removals first, as readers expect
    else all.push({ kind: 'add', text: b[j]!, newNo: ++j });
  }
  return fold(all, context);
}

/** Keep `context` unchanged lines next to every change; replace longer unchanged stretches with one marker line. */
function fold(lines: DiffLine[], context: number): DiffLine[] {
  const changed = lines.map((l) => l.kind !== 'ctx');
  const keep = [...changed]; // read from `changed` only: marking from `keep` would spread the context to the end of the file
  changed.forEach((c, i) => {
    if (c) for (let d = 1; d <= context; d++) { keep[i - d] = true; keep[i + d] = true; }
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i] || !lines.some((x) => x.kind !== 'ctx')) {
      if (skipped) out.push({ kind: 'ctx', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` , fold: true });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ kind: 'ctx', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}`, fold: true });
  return out;
}

export const countChanges = (lines: DiffLine[]) => ({ added: lines.filter((l) => l.kind === 'add').length, removed: lines.filter((l) => l.kind === 'del').length });
