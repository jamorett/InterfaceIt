/**
 * Text that is still streaming can stop inside a code fence. Rendered as is, everything after the fence would be
 * swallowed into one code block and then jump back out when the closing fence arrives; closing it for the preview avoids that.
 */
export function closeOpenFence(text: string): string {
  let open: string | undefined; // the fence character run that opened the current block
  for (const line of text.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) continue;
    if (!open) open = m[1];
    else if (m[1]![0] === open[0] && m[1]!.length >= open.length && /^ {0,3}[`~]+\s*$/.test(line)) open = undefined;
  }
  return open ? `${text}${text.endsWith('\n') ? '' : '\n'}${open}` : text;
}

/** Only these may be followed. Anything else (javascript:, data:, file:) is dropped, so a link in model output cannot run code or read a local file. */
const SAFE_LINK = /^(https?:|mailto:|#|\/(?!\/))/i;
export const safeHref = (href: string | undefined): string | undefined => (href && SAFE_LINK.test(href.trim()) ? href.trim() : undefined);
