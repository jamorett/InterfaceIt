/** "C:\Users\me\project\src\store.ts" → "C:\Users\…\src\store.ts": keeps the start and the file name, drops the middle. */
export function middleTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max < 5) return s.slice(0, max);
  const keep = max - 1;
  const tail = Math.ceil(keep * 0.6);
  return `${s.slice(0, keep - tail)}…${s.slice(s.length - tail)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function percent(fraction: number): string {
  return `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`;
}
