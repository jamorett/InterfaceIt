import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import { strings } from '../strings.ts';

export type OnboardingKind = 'cliMissing' | 'cliOld' | 'notLoggedIn';

/** First-run checks: each failure says exactly what to type. The app never handles credentials (PLAN.md §1). */
export function Onboarding({ kind, command, onCheck }: { kind: OnboardingKind; /** the exact command to type, when the bridge knows better than the default */ command?: string; onCheck?: () => void }) {
  const [copied, setCopied] = useState(false);
  const t = strings.onboarding[kind];
  const shown = command ?? t.command;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
    } catch {
      /* clipboard blocked: the command is selectable on screen */
    }
  };
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] place-items-center overflow-auto bg-paper p-4 text-ink">
      <section aria-labelledby="ob-title" className="enter-slow @container w-full max-w-[480px] rounded-card border border-line bg-card p-5">
        <h1 id="ob-title" className="text-lg font-semibold">{t.title}</h1>
        <p className="mt-2 text-base text-muted">{t.body}</p>
        <div className="mt-4 flex items-center gap-2 rounded-control bg-well p-2">
          <code className="min-w-0 flex-1 overflow-x-auto font-mono text-base whitespace-nowrap" tabIndex={0}>{shown}</code>
          <Button onClick={copy} aria-label={strings.onboarding.copy}>
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            <span className="@max-md:sr-only">{copied ? strings.onboarding.copied : strings.onboarding.copy}</span>
          </Button>
        </div>
        <Button variant="primary" className="mt-4" onClick={onCheck}>{strings.onboarding.check}</Button>
      </section>
    </div>
  );
}
