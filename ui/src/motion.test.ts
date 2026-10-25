import { describe, expect, it } from 'vitest';
import { createAnimationGate } from './motion.ts';

function setup(extra: Parameters<typeof createAnimationGate>[0] = {}) {
  let t = 10_000;
  const gate = createAnimationGate({ now: () => t, hidden: () => false, ...extra });
  return { gate, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe('animation gate', () => {
  it('animates a fresh live event', () => {
    const { gate, now } = setup();
    expect(gate({ kind: 'tool_start', ts: now() })).toBe(true);
  });

  it('never animates replayed history', () => {
    const { gate, now } = setup();
    expect(gate({ kind: 'tool_start', ts: now(), replayed: true })).toBe(false);
  });

  it('skips events that were already older than 2 s on arrival', () => {
    const { gate, now } = setup();
    expect(gate({ kind: 'tool_start', ts: now() - 2500 })).toBe(false);
    expect(gate({ kind: 'tool_start', ts: now() - 1500 })).toBe(true);
  });

  it('skips everything while the tab is hidden', () => {
    const { gate, now } = setup({ hidden: () => true });
    expect(gate({ kind: 'tool_start', ts: now() })).toBe(false);
  });

  it('lets 10 events of one kind animate inside 100 ms, then skips the rest of the burst', () => {
    const { gate, now } = setup();
    const results = Array.from({ length: 50 }, () => gate({ kind: 'tool_start', ts: now() }));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
  });

  it('counts kinds separately and recovers once the burst window has passed', () => {
    const { gate, now, tick } = setup();
    for (let i = 0; i < 20; i++) gate({ kind: 'tool_start', ts: now() });
    expect(gate({ kind: 'subagent', ts: now() })).toBe(true);
    tick(150);
    expect(gate({ kind: 'tool_start', ts: now() })).toBe(true);
  });
});
