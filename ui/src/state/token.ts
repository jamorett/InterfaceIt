const KEY = 'ci-token';
let memoryToken: string | null = null;

/** The bridge prints a link ending in #t=<token>. Keep the token, then strip it from the address bar so it is not left in the history. */
export function readToken(): string | null {
  const m = /^#t=([0-9a-f]+)$/.exec(location.hash);
  if (m?.[1]) {
    memoryToken = m[1];
    history.replaceState(null, '', location.pathname + location.search);
    try { sessionStorage.setItem(KEY, m[1]); } catch { /* storage blocked: the token lives for this page load only */ }
  }
  if (memoryToken) return memoryToken;
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
