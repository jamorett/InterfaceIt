import type { PermissionMode } from '../model.ts';

/** Ctrl+Shift+M order. Bypass is left out on purpose: turning permissions off must be a deliberate choice from the menu, never a keystroke. */
const CYCLE: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'];

export function nextMode(current: PermissionMode): PermissionMode {
  const i = CYCLE.indexOf(current);
  return CYCLE[(i + 1) % CYCLE.length]!; // an unlisted mode (bypass) goes back to the start
}
