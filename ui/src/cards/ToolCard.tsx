import { Bot, Check, ChevronRight, FileText, Globe, LoaderCircle, Pencil, Search, Terminal, Wrench, X, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { ToolView } from '../model.ts';
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

export function ToolCard({ tool }: { tool: ToolView }) {
  const failed = tool.status === 'error';
  const [open, setOpen] = useState(failed); // a failure stays open so it can't be missed
  const Icon = icons[tool.name] ?? Wrench;
  const bodyId = `tool-${tool.id}`;
  const status = { running: strings.tool.running, ok: strings.tool.done, error: strings.tool.failed }[tool.status];
  return (
    <div
      data-instant={tool.instant ? '' : undefined}
      style={{ marginLeft: Math.min(tool.depth ?? 0, MAX_INDENT) * 16 }}
      className={`enter @container rounded-card border bg-card ${failed ? 'shake-once border-danger border-l-4' : 'border-line'}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="press hoverable flex min-h-9 w-full items-center gap-2 rounded-card px-3 py-1.5 text-left text-base pointer-coarse:min-h-11"
      >
        <ChevronRight aria-hidden className={`size-3.5 shrink-0 text-muted transition-transform duration-[var(--dur-instant)] ${open ? 'rotate-90' : ''}`} />
        <Icon aria-hidden className="size-4 shrink-0 text-muted" />
        <span className="font-medium">{tool.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted" title={tool.target}>{middleTruncate(tool.target, 64)}</span>
        {tool.elapsedSec !== undefined && <span className="hidden text-sm text-muted @md:inline">{strings.tool.elapsed(tool.elapsedSec)}</span>}
        <span className={`inline-flex shrink-0 items-center gap-1 text-sm ${failed ? 'text-danger' : tool.status === 'ok' ? 'text-accent' : 'text-muted'}`}>
          {tool.status === 'running' && <LoaderCircle aria-hidden className="spin size-4" />}
          {tool.status === 'ok' && <Check aria-hidden className="size-4" />}
          {failed && <X aria-hidden className="size-4" />}
          <span className="@max-md:sr-only">{status}</span>
        </span>
      </button>
      {open && (
        <div id={bodyId} className="enter border-t border-line p-3">
          {tool.output === undefined ? (
            <p className="text-sm text-muted">{tool.status === 'running' ? strings.tool.running : strings.tool.empty}</p>
          ) : (
            <pre tabIndex={0} aria-label={`${tool.name} output`} className="max-h-64 overflow-auto rounded-control bg-well p-2 font-mono text-sm leading-snug whitespace-pre text-ink">
              {tool.output || strings.tool.empty}
            </pre>
          )}
          {tool.truncatedBytes ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              {strings.tool.truncated(Math.round(tool.truncatedBytes / 1024))}
              <button type="button" className="text-accent underline underline-offset-2">{strings.tool.showFull}</button>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
