import type { Effort } from '@ci/shared';
import type { PermissionMode } from '../model.ts';

/** Ctrl+Shift+M order. Bypass is left out on purpose: turning permissions off must be a deliberate choice from the menu, never a keystroke. */
const CYCLE: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'];

export function nextMode(current: PermissionMode): PermissionMode {
  const i = CYCLE.indexOf(current);
  return CYCLE[(i + 1) % CYCLE.length]!; // an unlisted mode (bypass) goes back to the start
}

/**
 * The effort levels of the model in use. A Claude session reports its full id ("claude-haiku-5-5") while the model list uses
 * aliases ("haiku"), so an exact match is tried first and then an alias contained in the id.
 */
export function effortsFor(models: { value: string; efforts: Effort[] }[], model?: string): Effort[] | undefined {
  if (!model) return undefined;
  return (models.find((m) => m.value === model) ?? models.find((m) => m.value !== 'default' && model.includes(m.value)))?.efforts;
}
