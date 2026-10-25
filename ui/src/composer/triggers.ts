/** What the caret is typing: a "/command" at the very start, or an "@file" word anywhere. Pure, so it is easy to test. */
export type Trigger = { kind: 'slash' | 'file'; query: string; start: number; end: number };

export function triggerAt(text: string, caret: number): Trigger | undefined {
  const head = text.slice(0, caret);
  const slash = /^\/([\w:.-]*)$/.exec(head);
  if (slash) return { kind: 'slash', query: slash[1]!, start: 0, end: caret };
  const at = /(?:^|\s)@([^\s@]*)$/.exec(head);
  if (at) return { kind: 'file', query: at[1]!, start: caret - at[1]!.length - 1, end: caret };
  return undefined;
}

/** Replace the typed trigger with the chosen text and say where the caret goes. */
export function complete(text: string, t: Trigger, insert: string): { text: string; caret: number } {
  const tail = text.slice(t.end);
  const space = tail.startsWith(' ') ? '' : ' ';
  const next = text.slice(0, t.start) + insert + space + tail;
  return { text: next, caret: t.start + insert.length + 1 };
}

/** Commands whose name starts with the query come first, then those that merely contain it. */
export function matchCommands<T extends { name: string }>(all: T[], query: string, limit = 8): T[] {
  const q = query.toLowerCase();
  const starts = all.filter((c) => c.name.toLowerCase().startsWith(q));
  const has = all.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
  return [...starts, ...has].slice(0, limit);
}

export const MAX_IMAGES = 5;
export const MAX_SIDE = 2000;
export const MAX_BYTES = 5 * 1024 * 1024;

/** Keep the aspect ratio and bring the longer side down to MAX_SIDE; never enlarge. */
export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}
