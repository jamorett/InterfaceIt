import { strings } from '../strings.ts';

export function Splash() {
  return (
    <div role="status" className="grid h-full place-items-center bg-paper p-6 text-ink">
      <div className="flex items-center gap-3">
        <span aria-hidden className="breathe size-3 rounded-full bg-accent-fill" />
        <span className="text-md font-semibold">{strings.appName}</span>
        <span className="text-base text-muted">{strings.splash.text}</span>
      </div>
    </div>
  );
}
