import { isNvidiaModel, type Effort } from '@ci/shared';
import { GitBranch, Menu, MoreHorizontal, PanelRight } from 'lucide-react';
import { IconButton } from '../components/Button.tsx';
import { SessionBadge } from '../components/SessionBadge.tsx';
import type { PermissionMode, SessionState } from '../model.ts';
import { strings } from '../strings.ts';
import { StatusSummary, type StatusProps } from './StatusSummary.tsx';
import { ThemeButton } from './ThemeButton.tsx';
import { useTier } from './tier.ts';

export type HeaderProps = {
  project: string;
  branch?: string;
  state: SessionState;
  model: string;
  models: { value: string; label: string }[];
  mode: PermissionMode;
  /** the levels the current model supports; the selector is hidden when there are none */
  efforts?: Effort[];
  effort?: Effort;
  /** shown as a note when the agent has switched its reasoning off */
  thinkingOff?: boolean;
  onEffort?: (effort: Effort) => void;
  onMenu?: () => void;
  onModel?: (value: string) => void;
  onMode?: (mode: PermissionMode) => void;
  onToggleInspector?: () => void;
  inspectorOpen?: boolean;
  status: StatusProps;
};

const modes = Object.keys(strings.mode) as PermissionMode[];

/** `shrinks`: the one select whose options are long (the model) may get narrower when space is tight; the others keep their size. */
function Select({ label, value, onChange, children, shrinks }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; shrinks?: boolean }) {
  return (
    <label className={`flex items-center gap-1.5 text-sm text-muted ${shrinks ? 'min-w-0' : ''}`}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`min-h-8 rounded-control border border-line bg-card px-2 text-base text-ink pointer-coarse:min-h-11 ${shrinks ? 'min-w-0 flex-1' : ''}`}>{children}</select>
    </label>
  );
}

export function Header(p: HeaderProps) {
  const tier = useTier();
  const narrow = tier === 'narrow';
  const isNvidia = isNvidiaModel;
  const allModels = p.models.some((m) => m.value === p.model) ? p.models : [{ value: p.model, label: p.model }, ...p.models];
  const claudeGroup = allModels.filter((m) => !isNvidia(m.value));
  const nvidiaGroup = allModels.filter((m) => isNvidia(m.value));

  const controls = (
    <>
      <Select shrinks label={strings.header.model} value={p.model} onChange={(v) => p.onModel?.(v)}>
        {claudeGroup.length > 0 && nvidiaGroup.length > 0 ? (
          <>
            <optgroup label={strings.nvidia.claudeGroup}>
              {claudeGroup.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </optgroup>
            <optgroup label={strings.nvidia.nvidiaGroup}>
              {nvidiaGroup.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </optgroup>
          </>
        ) : (
          allModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)
        )}
      </Select>
      {p.efforts && p.efforts.length > 0 && (
        <Select label={strings.header.effort} value={p.effort ?? ''} onChange={(v) => p.onEffort?.(v as Effort)}>
          {p.effort === undefined && <option value="" disabled>{strings.header.effortUnset}</option>}
          {p.efforts.map((e) => <option key={e} value={e}>{strings.effort[e]}</option>)}
        </Select>
      )}
      {p.thinkingOff && <span className="shrink-0 text-sm text-muted" title={strings.header.thinkingOffHint}>{strings.header.thinkingOff}</span>}
      <Select label={strings.header.permissions} value={p.mode} onChange={(v) => p.onMode?.(v as PermissionMode)}>
        {modes.map((m) => <option key={m} value={m}>{strings.mode[m]}</option>)}
      </Select>
    </>
  );
  return (
    <header className="flex items-center gap-2 border-b border-line bg-paper px-4 py-1.5">
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
      <ThemeButton />
      {p.onToggleInspector && (
        <IconButton label={strings.header.inspector} aria-pressed={p.inspectorOpen} onClick={p.onToggleInspector} className={p.inspectorOpen ? 'bg-well' : ''}>
          <PanelRight aria-hidden className="size-5" />
        </IconButton>
      )}
    </header>
  );
}
