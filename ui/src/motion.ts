// JS side of the motion system (PLAN.md §8). The CSS side is the --dur-* / --ease-* variables in theme.css.
// Most animation is plain CSS; JS only needs these numbers for Motion (springs, layout) and for the gate below.

export const duration = { instant: 100, quick: 160, base: 240, slow: 360 } as const;

export const ease = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

export const spring = { type: 'spring', duration: 0.4, bounce: 0.15 } as const;

export type GateEvent = {
  kind: string;
  /** when the event happened at the bridge (ms since epoch) */
  ts: number;
  /** delivered by replay_from / resume, i.e. history */
  replayed?: boolean;
};

type GateOptions = {
  now?: () => number;
  hidden?: () => boolean;
  maxAgeMs?: number;
  burstLimit?: number;
  burstWindowMs?: number;
};

/**
 * Decides whether an event may play its enter animation. Animations follow real, live events only:
 * replayed history, events that were already old on arrival, a hidden tab, and bursts (the 11th and later
 * event of one kind inside 100 ms, e.g. 50 Read calls) render instantly.
 */
export function createAnimationGate(opts: GateOptions = {}) {
  const now = opts.now ?? Date.now;
  const hidden = opts.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
  const maxAge = opts.maxAgeMs ?? 2000;
  const limit = opts.burstLimit ?? 10;
  const window = opts.burstWindowMs ?? 100;
  const recent = new Map<string, number[]>();

  return function shouldAnimate(e: GateEvent): boolean {
    if (e.replayed || hidden()) return false;
    const t = now();
    if (t - e.ts > maxAge) return false;
    const times = (recent.get(e.kind) ?? []).filter((x) => t - x < window);
    times.push(t);
    recent.set(e.kind, times);
    return times.length <= limit;
  };
}
