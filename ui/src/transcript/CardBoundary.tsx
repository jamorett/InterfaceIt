import { Component, type ReactNode } from 'react';
import { strings } from '../strings.ts';

export function CrashCard({ raw }: { raw: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(raw, null, 2) ?? String(raw);
  } catch {
    text = String(raw);
  }
  return (
    <div role="group" aria-label={strings.transcript.crash} className="rounded-card border border-danger bg-card p-3 text-base">
      <p className="font-medium">{strings.transcript.crash}</p>
      <p className="text-sm text-muted">{strings.transcript.crashDetail}</p>
      <pre tabIndex={0} aria-label="Raw data" className="mt-2 max-h-40 overflow-auto rounded-control bg-well p-2 font-mono text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</pre>
    </div>
  );
}

/** One bad card must never take down the conversation (PLAN.md §10): a renderer that throws falls back to the raw data. */
export class CardBoundary extends Component<{ raw: unknown; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('A transcript card failed to render', error);
  }
  render() {
    return this.state.failed ? <CrashCard raw={this.props.raw} /> : this.props.children;
  }
}
