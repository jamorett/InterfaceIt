// View models: what the components render. M1 step 3 maps bridge events (shared/events.ts) onto these,
// so components never see SDK or wire shapes and the dev gallery can feed them plain objects.

// one definition, shared with the bridge
import type { SessionState } from '@ci/shared';
export type { PermissionMode, SessionState } from '@ci/shared';

/** Set on anything that must not play its enter animation (replayed history, bursts: see motion.ts). */
type Instant = { instant?: boolean };

export type ToolView = Instant & {
  id: string;
  name: string;
  target: string;
  status: 'running' | 'ok' | 'error';
  elapsedSec?: number;
  output?: string;
  truncatedBytes?: number;
  /** what the tool was asked to do (Edit's old and new text, Write's content): the side panel shows its diff */
  input?: unknown;
  images?: { mediaType: string; data: string }[];
  /** the whole output has been fetched, after it was cut for the wire */
  full?: boolean;
  depth?: number;
};

export type DiffLine = { kind: 'add' | 'del' | 'ctx'; text: string; oldNo?: number; newNo?: number; /** a "… N unchanged lines" marker, not a line of the text */ fold?: boolean };

export type PermissionDecision = 'allowed-once' | 'allowed-session' | 'allowed-local' | 'allowed-project' | 'allowed-user' | 'denied' | 'cancelled';

export type PermissionView = Instant & {
  id: string;
  title: string;
  target: string;
  description?: string;
  agent?: string;
  diff?: DiffLine[];
  /** the SDK says this must be answered by a person, so "always allow" is not offered */
  requiresUserInteraction?: boolean;
  /** false when the CLI offered nothing to remember: "Allow for…" is hidden */
  canRemember?: boolean;
  /** a field the user may change before allowing (the command of a Bash call) */
  editable?: { key: string; value: string };
  decision?: PermissionDecision;
  denyReason?: string;
};

export type QuestionView = Instant & {
  id: string;
  /** the request this question belongs to; several questions can share one */
  reqId?: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
  answer?: string[];
};

export type PlanView = Instant & {
  id: string;
  text: string;
  decision?: 'approved-auto' | 'approved-manual' | 'rejected';
};

export type LaneView = {
  id: string;
  type: string;
  description: string;
  state: 'running' | 'completed' | 'failed' | 'stopped';
  toolUses: number;
  tokens: number;
  depth: number;
};

export type TodoItem = { content: string; activeForm: string; status: 'pending' | 'in_progress' | 'completed' };

export type TranscriptItem =
  | (Instant & { kind: 'user'; id: string; text: string; images?: { mediaType: string; data: string }[] })
  | (Instant & { kind: 'assistant'; id: string; text: string; streaming?: boolean; synthetic?: boolean })
  | { kind: 'thinking'; id: string; tokens: number; live: boolean; seconds?: number }
  | { kind: 'tool'; tool: ToolView }
  | { kind: 'permission'; view: PermissionView }
  | { kind: 'question'; view: QuestionView }
  | { kind: 'plan'; view: PlanView }
  | { kind: 'compact'; id: string; before: number; after: number }
  | { kind: 'notice'; id: string; level: 'info' | 'warning' | 'danger'; text: string }
  | { kind: 'stopped'; id: string }
  | { kind: 'unknown'; id: string; raw: unknown }
  | { kind: 'crash'; id: string; raw: unknown };

export type SessionSummary = { id: string; project: string; title: string; state: SessionState; updated: string; /** running in the bridge, so it can be closed */ live?: boolean };

export type ContextView = { totalTokens: number; maxTokens: number };
export type LimitWindow = { label: string; utilization: number; resetsAt: string };
