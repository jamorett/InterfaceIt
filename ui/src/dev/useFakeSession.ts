import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionDecision, SessionState, TranscriptItem } from '../model.ts';
import { createAnimationGate } from '../motion.ts';
import * as fx from './fixtures.ts';

function withInstant(item: TranscriptItem, instant: boolean): TranscriptItem {
  if (!instant) return item;
  if (item.kind === 'tool') return { ...item, tool: { ...item.tool, instant } };
  if (item.kind === 'permission') return { ...item, view: { ...item.view, instant } };
  if (item.kind === 'question') return { ...item, view: { ...item.view, instant } };
  if (item.kind === 'plan') return { ...item, view: { ...item.view, instant } };
  if (item.kind === 'user' || item.kind === 'assistant') return { ...item, instant };
  return item;
}

const idOf = (i: TranscriptItem) => (i.kind === 'tool' ? i.tool.id : 'view' in i ? i.view.id : i.id);

/**
 * Plays a scripted session through the same animation gate the real store will use:
 * live events animate, replayed history and bursts do not (PLAN.md §8.3). Dev gallery only.
 */
export function useFakeSession() {
  const gate = useRef(createAnimationGate());
  const timers = useRef<number[]>([]);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [state, setState] = useState<SessionState>('idle');

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => clear, []);

  const push = useCallback((item: TranscriptItem, kind: string, replayed = false) => {
    const instant = !gate.current({ kind, ts: Date.now(), replayed });
    setItems((p) => [...p, withInstant(item, instant)]);
  }, []);
  const patch = (id: string, f: (i: TranscriptItem) => TranscriptItem) => setItems((p) => p.map((i) => (idOf(i) === id ? f(i) : i)));

  const finish = () => {
    push({ kind: 'assistant', id: 'f1', text: '', streaming: true }, 'text');
    const words = 'The test failed because the store had no version field. I added it and all three tests pass now.'.split(' ');
    words.forEach((_, i) => later(i * 60, () => patch('f1', (it) => (it.kind === 'assistant' ? { ...it, text: words.slice(0, i + 1).join(' '), streaming: i < words.length - 1 } : it))));
    later(words.length * 60 + 100, () => setState('idle'));
  };

  const play = () => {
    clear();
    setItems([]);
    setState('running');
    push({ kind: 'user', id: 'fu', text: 'Fix the failing test in store.test.ts' }, 'user');
    later(300, () => push({ kind: 'thinking', id: 'fth', tokens: 240, live: true }, 'thinking'));
    later(900, () => { patch('fth', (i) => (i.kind === 'thinking' ? { ...i, live: false, seconds: 3 } : i)); push({ kind: 'tool', tool: { id: 'fr', name: 'Read', target: 'ui/src/store.ts', status: 'running' } }, 'tool_start'); });
    later(1500, () => patch('fr', (i) => (i.kind === 'tool' ? { kind: 'tool', tool: { ...i.tool, status: 'ok', elapsedSec: 0.4, output: 'export const store = create(() => ({ items: [] }));\n' } } : i)));
    later(1900, () => { setState('awaiting_permission'); push({ kind: 'permission', view: { ...fx.permissionEdit, id: 'fp' } }, 'permission'); });
  };

  const decide = (id: string, d: PermissionDecision, reason?: string) => {
    patch(id, (i) => (i.kind === 'permission' ? { ...i, view: { ...i.view, decision: d, denyReason: reason, instant: true } } : i));
    if (id !== 'fp') return;
    setState('running');
    if (d === 'denied') { push({ kind: 'stopped', id: 'fs' }, 'stopped'); setState('idle'); return; }
    later(300, () => push({ kind: 'tool', tool: { id: 'fe', name: 'Edit', target: 'ui/src/store.ts', status: 'running' } }, 'tool_start'));
    later(900, () => patch('fe', (i) => (i.kind === 'tool' ? { kind: 'tool', tool: { ...i.tool, status: 'ok', elapsedSec: 0.2 } } : i)));
    later(1200, finish);
  };

  /** the whole finished conversation delivered at once, as on resume: nothing animates */
  const replay = () => {
    clear();
    setItems([]);
    setState('idle');
    fx.baseTranscript.forEach((it, i) => push(it, `replay-${i}`, true));
  };

  /** 50 tool cards inside one frame: the first ten animate, the rest appear instantly */
  const burst = () => {
    clear();
    setItems([]);
    for (let i = 0; i < 50; i++) push({ kind: 'tool', tool: { id: `b${i}`, name: 'Read', target: `src/file-${i}.ts`, status: 'ok', elapsedSec: 0.1 } }, 'tool_start');
  };

  return { items, state, play, replay, burst, decide };
}
