import { strings } from '../strings.ts';

/** Opened without the one-time link (or the bridge was restarted, which makes the old link invalid). */
export function NoLink() {
  return (
    <div className="grid h-full min-h-dvh grid-cols-[minmax(0,1fr)] place-items-center bg-paper p-4 text-ink">
      <p role="status" className="enter-slow max-w-[420px] rounded-card border border-line bg-card p-5 text-base">{strings.noLink}</p>
    </div>
  );
}
