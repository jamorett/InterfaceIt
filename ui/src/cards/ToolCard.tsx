import { Bot, Check, ChevronRight, FileText, Globe, LoaderCircle, PanelRight, Pencil, Search, Terminal, Wrench, X, type LucideIcon } from 'lucide-react';
import { useContext, useMemo, useState } from 'react';
import { AnsiText } from '../components/AnsiText.tsx';
import { IconButton } from '../components/Button.tsx';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { DiffView } from '../components/DiffView.tsx';
import type { ToolView } from '../model.ts';
import { InspectorContext } from '../shell/inspector.ts';
import { diffFor, imageSrc, readPreview } from '../state/describe.ts';
import { strings } from '../strings.ts';
import { middleTruncate } from '../text.ts';

// Icons are cosmetic: any tool name not listed here gets the wrench and the same card (PLAN.md §4 rule 3).
const icons: Record<string, LucideIcon> = {
  Bash: Terminal, PowerShell: Terminal, Monitor: Terminal,
  Read: FileText, NotebookEdit: Pencil, Edit: Pencil, Write: Pencil, MultiEdit: Pencil,
  Grep: Search, Glob: Search, ToolSearch: Search,
  WebFetch: Globe, WebSearch: Globe,
  Agent: Bot, Task: Bot,
};

const MAX_INDENT = 3;
const INLINE_DIFF_LINES = 80;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function ToolCard({ tool, onFull }: { tool: ToolView; onFull?: (toolId: string) => void }) {
  const failed = tool.status === 'error';
  const [open, setOpen] = useState(failed); // a failure stays open so it can't be missed
  const openPanel = useContext(InspectorContext);
  const Icon = icons[tool.name] ?? Wrench;
  const bodyId = `tool-${tool.id}`;
  const status = { running: strings.tool.running, ok: strings.tool.done, error: strings.tool.failed }[tool.status];

  // what the card can show beyond its one line: the change an Edit/Write makes, a Read as code, or the raw output
  const diff = useMemo(() => (isRecord(tool.input) ? diffFor(tool.name, tool.input, 400) : undefined), [tool.name, tool.input]);
  const read = useMemo(() => (tool.name === 'Read' && tool.output ? readPreview(tool.output, tool.target) : undefined), [tool.name, tool.output, tool.target]);
  const images = (tool.images ?? []).flatMap((im) => { const src = imageSrc(im); return src ? [src] : []; });
  const title = `${tool.name} ${tool.target}`.trim();

  const panel = () =>
    openPanel(diff ? { kind: 'diff', title, path: tool.target, lines: diff }
      : read ? { kind: 'code', title, code: read.code, language: read.language }
      : { kind: 'output', title, text: tool.output ?? '' });

  return (
    <div
      data-instant={tool.instant ? '' : undefined}
      style={{ marginLeft: Math.min(tool.depth ?? 0, MAX_INDENT) * 16 }}
      className={`enter @container rounded-card border bg-card shadow-card ${failed ? 'shake-once border-danger border-l-4' : 'border-line'}`}
    >
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="press hoverable flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-card px-3 py-1.5 text-left text-base pointer-coarse:min-h-11"
        >
          <ChevronRight aria-hidden className={`size-3.5 shrink-0 text-muted transition-transform duration-[var(--dur-instant)] ${open ? 'rotate-90' : ''}`} />
          <Icon aria-hidden className="size-4 shrink-0 text-muted" />
          <span className="font-medium">{tool.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted" title={tool.target}>{middleTruncate(tool.target, 64)}</span>
          {tool.elapsedSec !== undefined && <span className="hidden text-sm text-muted tabular-nums @md:inline">{strings.tool.elapsed(tool.elapsedSec)}</span>}
          <span className={`inline-flex shrink-0 items-center gap-1 text-sm ${failed ? 'text-danger' : tool.status === 'ok' ? 'text-accent' : 'text-muted'}`}>
            {tool.status === 'running' && <LoaderCircle aria-hidden className="spin size-4" />}
            {tool.status === 'ok' && <Check aria-hidden className="size-4" />}
            {failed && <X aria-hidden className="size-4" />}
            <span className="@max-md:sr-only">{status}</span>
          </span>
        </button>
        {tool.status !== 'running' && (diff || tool.output) && (
          <IconButton label={strings.tool.openPanel} onClick={panel} className="mr-1 shrink-0"><PanelRight aria-hidden className="size-4" /></IconButton>
        )}
      </div>
      {open && (
        <div id={bodyId} className="enter border-t border-line p-3">
          {diff && <DiffView lines={diff.slice(0, INLINE_DIFF_LINES)} label={strings.diff.preview} className="max-h-64" />}
          {!diff && read && <CodeBlock code={read.code} language={read.language} className="!my-0" />}
          {!diff && !read && (tool.output === undefined ? (
            <p className="text-sm text-muted">{tool.status === 'running' ? strings.tool.running : strings.tool.empty}</p>
          ) : (
            <pre tabIndex={0} aria-label={`${tool.name} output`} className="max-h-64 overflow-auto rounded-control bg-well p-2 font-mono text-sm leading-snug whitespace-pre text-ink">
              {tool.output ? <AnsiText text={tool.output} /> : strings.tool.empty}
            </pre>
          ))}
          {diff && failed && tool.output && <p className="mt-2 text-sm [overflow-wrap:anywhere]">{tool.output}</p>}
          {images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {images.map((src, i) => (
                <button key={i} type="button" onClick={() => openPanel({ kind: 'image', title: strings.tool.image, src })} className="press rounded-control">
                  <img src={src} alt={strings.tool.image} className="max-h-32 max-w-full rounded-control border border-line" />
                </button>
              ))}
            </div>
          )}
          {tool.truncatedBytes ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              {strings.tool.truncated(Math.round(tool.truncatedBytes / 1024))}
              <button type="button" onClick={() => onFull?.(tool.id)} className="text-accent underline underline-offset-2">{strings.tool.showFull}</button>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
