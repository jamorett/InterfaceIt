import Anser from 'anser';

/**
 * Terminal output as text that is safe and readable on a page:
 * - a progress bar that rewrites its line with "\r" shows only its last state,
 * - cursor movement, screen clearing and title sequences (everything that is not a colour) are dropped,
 * - stray control characters and a broken UTF-8 replacement run are removed.
 * Colour codes are kept for `ansiSpans`.
 */
export function cleanOutput(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '') // OSC: window title, hyperlinks
    .replace(/\u001b\[[0-9;?]*[A-Za-ln-z]/g, '') // CSI that is not "m" (colour): cursor moves, erase, scroll
    .split('\n')
    .map((line) => {
      const l = line.endsWith('\r') ? line.slice(0, -1) : line;
      return l.includes('\r') ? l.slice(l.lastIndexOf('\r') + 1) : l;
    })
    .join('\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '')
    .replace(/�{3,}/g, '�');
}

/** How much of a long output a block shows before offering the rest: keeps a 4 MB log from becoming a 4 MB DOM. */
export const MAX_SHOWN_CHARS = 60_000;

export type Span = { text: string; fg?: string; bold?: boolean; italic?: boolean; underline?: boolean };

const names = new Set(['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']);

/** Split cleaned output into runs of equal style. `fg` is a plain colour name (red, bright-green …); the component maps it to a token. */
export function ansiSpans(text: string): Span[] {
  const parts = Anser.ansiToJson(cleanOutput(text), { json: true, remove_empty: true, use_classes: true });
  return parts.map((p) => {
    const base = typeof p.fg === 'string' ? p.fg.replace(/^ansi-/, '') : undefined; // "ansi-bright-red" → "bright-red"
    const fg = base && names.has(base.replace(/^bright-/, '')) ? base : undefined; // 256-colour and true-colour values are ignored on purpose
    const d = p.decorations ?? [];
    return { text: p.content, fg, bold: d.includes('bold') || undefined, italic: d.includes('italic') || undefined, underline: d.includes('underline') || undefined };
  });
}
