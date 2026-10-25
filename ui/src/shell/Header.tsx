import { GitBranch, Menu, MoreHorizontal, PanelRight } from 'lucide-react';
import { IconButton } from '../components/Button.tsx';
import { SessionBadge } from '../components/SessionBadge.tsx';
import type { PermissionMode, SessionState } from '../model.ts';
import { strings } from '../strings.ts';
import { StatusSummary, type StatusProps } from './StatusSummary.tsx';
import { useTier } from './tier.ts';

export type HeaderProps = {
  project: string;
  branch?: string;
  state: SessionState;
  model: string;
  models: { value: string; label: string }[];
  mode: PermissionMode;
  onMenu?: () => void;
  onToggleInspector?: () => void;
  inspectorOpen?: boolean;
  status: StatusProps;
};

const modes = Object.keys(strings.mode) as PermissionMode[];

function Select({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted">
      {label}
      <select defaultValue={value} className="min-h-8 rounded-control border border-line bg-card px-2 text-base text-ink pointer-coarse:min-h-11">{children}</select>
    </label>
  );
}

export function Header(p: HeaderProps) {
  const tier = useTier();
  const narrow = tier === 'narrow';
  const controls = (
    <>
      <Select label={strings.header.model} value={p.model}>
        {p.models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
      <Select label={strings.header.permissions} value={p.mode}>
        {modes.map((m) => <option key={m} value={m}>{strings.mode[m]}</option>)}
      </Select>
    </>
  );
  return (
    <header className="flex items-center gap-2 border-b border-line bg-paper px-3 py-1.5">
      {(narrow || tier === 'tablet') && (
        <IconButton label={strings.header.menu} onClick={p.onMenu}><Menu aria-hidden className="size-5" /></IconButton>
      )}
      <h1 className="min-w-0 truncate text-md font-semibold" title={p.project}>{p.project}</h1>
      {p.branch && !narrow && (
        <span className="hidden items-center gap-1 rounded-full border border-line px-2 text-sm text-muted @tablet:inline-flex">
          <GitBranch aria-hidden className="size-3.5" /> {p.branch}
        </span>
      )}
      <span className="ml-auto" />
      {narrow ? (
        <>
          <SessionBadge state={p.state} labelHidden />
          <details className="relative">
            <summary aria-label={strings.header.more} className="press flex size-8 cursor-pointer list-none items-center justify-center rounded-control hover:bg-well pointer-coarse:size-11">
              <MoreHorizontal aria-hidden className="size-5" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 grid w-72 max-w-[calc(100vw-1.5rem)] gap-3 rounded-card border border-line bg-card p-3 shadow-lg">
              {controls}
              <StatusSummary {...p.status} />
            </div>
          </details>
        </>
      ) : (
        controls
      )}
      <IconButton label={strings.header.inspector} aria-pressed={p.inspectorOpen} onClick={p.onToggleInspector} className={p.inspectorOpen ? 'bg-well' : ''}>
        <PanelRight aria-hidden className="size-5" />
      </IconButton>
    </header>
  );
}
