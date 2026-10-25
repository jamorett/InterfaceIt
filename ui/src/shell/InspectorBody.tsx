import { AnsiText } from '../components/AnsiText.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { countChanges } from '../state/diff.ts';
import { strings } from '../strings.ts';
import type { InspectorContent } from './inspector.ts';

/** Whole outputs are shown up to this many characters; beyond it the panel says so instead of building a multi-megabyte page. */
const PANEL_LIMIT = 400_000;

export function InspectorBody({ content }: { content: InspectorContent }) {
  switch (content.kind) {
    case 'diff': {
      const { added, removed } = countChanges(content.lines);
      return (
        <div className="grid gap-2">
          <p className="font-mono text-sm [overflow-wrap:anywhere]">{content.path}</p>
          <p className="text-sm text-muted"><span className="text-accent">{strings.diff.added(added)}</span> <span className="text-danger">{strings.diff.removed(removed)}</span></p>
          <DiffView lines={content.lines} label={strings.diff.full} />
        </div>
      );
    }
    case 'output':
      return (
        <div className="grid gap-2">
          <pre tabIndex={0} aria-label={content.title} className="overflow-auto rounded-control bg-well p-2 font-mono text-sm leading-snug whitespace-pre text-ink">
            <AnsiText text={content.text} limit={PANEL_LIMIT} />
          </pre>
          {content.text.length > PANEL_LIMIT && <p className="text-sm text-muted">{strings.inspector.cut(PANEL_LIMIT.toLocaleString(), content.text.length.toLocaleString())}</p>}
        </div>
      );
    case 'code':
      return <CodeBlock code={content.code} language={content.language} />;
    case 'image':
      return <img src={content.src} alt={content.title} className="max-h-full max-w-full rounded-control border border-line" />;
  }
}
