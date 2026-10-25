const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;

/** "now", "4m", "3h", "yesterday", "Mon", "Oct 12": how long ago a session was last used. */
export function ago(ms: number, now: number = Date.now()): string {
  const s = (now - ms) / 1000;
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(new Date(ms))) / DAY);
  if (days <= 0) return `${Math.round(s / 3600)}h`;
  if (days === 1) return 'yesterday';
  const d = new Date(ms);
  return days < 7 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** When a usage limit resets, in plain words: "22:19", "tomorrow 05:59", "Mon 05:59". `epochSec` is in seconds, as the SDK reports it. */
export function resetsAt(epochSec: number, now: number = Date.now()): string {
  const d = new Date(epochSec * 1000);
  const days = Math.round((startOfDay(d) - startOfDay(new Date(now))) / DAY);
  if (days <= 0) return hhmm(d);
  if (days === 1) return `tomorrow ${hhmm(d)}`;
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${hhmm(d)}`;
}
