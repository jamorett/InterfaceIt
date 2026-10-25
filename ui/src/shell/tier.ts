import { createContext, useContext, useLayoutEffect, useState, type RefObject } from 'react';

/** The four layout tiers of PLAN.md §7.3, measured on the shell itself (not the window) so the dev gallery can show them side by side. */
export type Tier = 'narrow' | 'tablet' | 'laptop' | 'desktop';

export function tierFor(width: number): Tier {
  if (width < 720) return 'narrow';
  if (width < 1024) return 'tablet';
  if (width < 1440) return 'laptop';
  return 'desktop';
}

/** Below this width a docked inspector would squeeze the transcript under 560 px (56 rail + 560 + 420), so it becomes an overlay. */
export const INSPECTOR_DOCK_MIN = 1036;

export const TierContext = createContext<Tier>('desktop');
export const useTier = () => useContext(TierContext);

export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(1440);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
