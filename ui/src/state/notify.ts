import type { SessionState } from '@ci/shared';
import { strings } from '../strings.ts';

/**
 * What to tell the user, if anything, when a session's status changes while they are looking at something else.
 * Only "needs you" and "finished" matter: nothing is announced for the transitions in between.
 */
export function notificationFor(prev: SessionState | undefined, next: SessionState, project: string): { title: string; body: string } | undefined {
  if (prev === next) return undefined;
  if (next === 'awaiting_permission') return { title: strings.notify.permission, body: project };
  if (next === 'awaiting_answer') return { title: strings.notify.question, body: project };
  if (next === 'idle' && prev && prev !== 'awaiting_permission' && prev !== 'awaiting_answer') return { title: strings.notify.done, body: project };
  if (next === 'rate_limited') return { title: strings.notify.limit, body: project };
  if (next === 'error') return { title: strings.notify.error, body: project };
  return undefined;
}

/** Whether the window is out of sight (another tab or another app). A focused window needs no pop-up: the card is right there. */
export const windowIsAway = () => typeof document !== 'undefined' && (document.hidden || !document.hasFocus());

export function showNotification(n: { title: string; body: string }, tag: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const note = new Notification(n.title, { body: n.body, tag }); // one per session: a newer one replaces the older
    note.onclick = () => { window.focus(); note.close(); };
  } catch { /* some browsers only allow it from a service worker: then there is simply no pop-up */ }
}

/** Asks once, on the first click or key press (browsers refuse to show the question without a user gesture). */
export function askNotificationPermissionOnce() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  const ask = () => {
    window.removeEventListener('pointerdown', ask);
    window.removeEventListener('keydown', ask);
    void Notification.requestPermission();
  };
  window.addEventListener('pointerdown', ask, { once: true });
  window.addEventListener('keydown', ask, { once: true });
}
