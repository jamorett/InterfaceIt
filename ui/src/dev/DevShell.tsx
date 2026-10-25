import { useEffect, useState } from 'react';
import { scenarioNames } from './scenario-names.ts';
import { scenarios } from './scenarios.tsx';

/** /dev/shell?state=<scenario>: one scenario filling the whole window, so tests and screenshots see the real layout tiers. */
export function DevShell() {
  const name = new URLSearchParams(location.search).get('state') ?? '';
  const render = (scenarios as Record<string, (() => React.ReactNode) | undefined>)[name];
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className="h-dvh" data-ready={ready ? '' : undefined} data-scenario={name}>
      {render ? render() : <p className="p-4">Unknown scenario “{name}”. Try: {scenarioNames.join(', ')}</p>}
    </div>
  );
}
