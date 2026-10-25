// Every user-facing string lives here (PLAN.md §1: English now, a Spanish file later, no i18n library).
import type { PermissionDecision, PermissionMode, SessionState } from './model.ts';

export const strings = {
  // connection (App.tsx)
  connecting: 'Connecting…',
  connected: 'Connected',
  noLink: 'Open the link printed in the terminal (type "url" + Enter there to print it again).',
  closed: 'The bridge is not reachable.',

  appName: 'ClaudeInterface',
  poweredBy: 'Powered by Claude',

  state: {
    idle: 'Idle',
    running: 'Working',
    awaiting_permission: 'Needs you',
    awaiting_answer: 'Needs you',
    compacting: 'Compacting',
    retrying: 'Retrying',
    rate_limited: 'Limit reached',
    error: 'Error',
    ended: 'Ended',
  } satisfies Record<SessionState, string>,

  mode: {
    default: 'Manual',
    acceptEdits: 'Accept edits',
    auto: 'Auto',
    plan: 'Plan',
    dontAsk: "Don't ask",
    bypassPermissions: 'Bypass permissions',
  } satisfies Record<PermissionMode, string>,

  header: {
    menu: 'Open sessions',
    more: 'More',
    model: 'Model',
    permissions: 'Permissions',
    inspector: 'Toggle inspector',
    bypassWarning: 'Permissions are off: Claude can change files and run commands without asking.',
  },

  sidebar: {
    title: 'Sessions',
    search: 'Search sessions',
    newSession: 'New session',
    close: 'Close sessions',
  },

  tool: {
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    elapsed: (s: number) => (s < 10 ? `${s.toFixed(1)}s` : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`),
    truncated: (kb: number) => `Output cut at the first 64 KB (${kb} KB total).`,
    showFull: 'Show full output',
    openPanel: 'Open in side panel',
    image: 'Image from the tool',
    loading: 'Loading…',
    expand: 'Show details',
    collapse: 'Hide details',
    empty: '(no output)',
  },

  thinking: {
    live: (tokens: number) => `Thinking… ~${tokens} tokens`,
    done: (s: number) => `Thought for ${s}s`,
  },

  permission: {
    needsOk: 'Needs your OK',
    allow: 'Allow',
    allowFor: 'Allow for…',
    deny: 'Deny…',
    denyNow: 'Deny',
    cancel: 'Cancel',
    reasonLabel: 'Tell Claude why (optional)',
    keys: 'Keys: Y allow · N deny · A allow for…',
    keysOnce: 'Keys: Y allow · N deny',
    scopes: {
      'allowed-session': 'This session',
      'allowed-local': 'This project, only me',
      'allowed-project': 'This project, shared',
      'allowed-user': 'Everywhere',
    },
    decided: {
      'allowed-once': 'Allowed once',
      'allowed-session': 'Allowed for this session',
      'allowed-local': 'Allowed for this project (only you)',
      'allowed-project': 'Allowed for this project (shared)',
      'allowed-user': 'Allowed everywhere',
      denied: 'Denied',
      cancelled: 'Cancelled (you pressed Stop)',
    } satisfies Record<PermissionDecision, string>,
    requiresPerson: 'This one always needs you.',
    by: (agent: string) => `Asked by ${agent}`,
  },

  question: {
    header: 'Claude has a question',
    other: 'Other',
    otherPlaceholder: 'Type your own answer',
    submit: 'Answer',
    answered: (a: string) => `You answered: ${a}`,
    chooseOne: 'Choose one',
    chooseMany: 'Choose any',
  },

  plan: {
    header: 'Plan ready for review',
    region: 'Plan',
    approveAuto: 'Approve and auto-accept edits',
    approveManual: 'Approve, review each edit',
    reject: 'Reject…',
    feedback: 'What should change?',
    sendFeedback: 'Send feedback',
    decided: {
      'approved-auto': 'Plan approved (edits accepted automatically)',
      'approved-manual': 'Plan approved (you review each edit)',
      rejected: 'Plan rejected',
    },
  },

  lanes: {
    region: 'Subagents',
    more: (n: number) => `+${n} more`,
    state: { running: 'Running', completed: 'Done', failed: 'Failed', stopped: 'Stopped' },
    detail: (tools: number, tokens: string) => `${tools} tool${tools === 1 ? '' : 's'} · ${tokens} tokens`,
  },

  todo: {
    region: 'Progress',
    summary: (done: number, total: number, now?: string) => `${done} / ${total}${now ? ` · ${now}` : ''}`,
    pending: 'Pending',
    inProgress: 'In progress',
    completed: 'Done',
  },

  context: {
    label: 'Context',
    detail: (used: string, max: string, pct: number) => `${used} of ${max} tokens (${pct}%)`,
    compactHint: 'Nearly full. Try /compact.',
    compacted: (before: string, after: string) => `Conversation compacted: ${before} → ${after} tokens`,
  },

  limits: {
    label: 'Usage',
    resets: (when: string) => `resets ${when}`,
    warning: (pct: number, when: string) => `You have used ${pct}% of this period's limit (resets ${when}).`,
    reached: (when: string) => `Limit reached. You can send again ${when}.`,
  },

  status: {
    background: (n: number) => `${n} running in the background`,
    shell: 'shell',
    stopTask: 'Stop',
  },

  banner: {
    disconnected: (attempt: number) => `Connection lost. Reconnecting… (attempt ${attempt})`,
    retrying: (attempt: number, max: number) => `The API is busy. Retrying (${attempt}/${max})…`,
    draftKept: 'Your draft is kept.',
    dismiss: 'Dismiss',
  },

  composer: {
    label: 'Message',
    placeholder: 'Ask Claude to do something…  ( / commands · @ files )',
    send: 'Send',
    stop: 'Stop',
    queued: 'Queued',
    removeQueued: 'Remove queued message',
    suggestion: 'Suggested next prompt (Tab to use)',
    disabledLimit: 'Sending is paused until the limit resets.',
    disabledOffline: 'Sending is paused while disconnected.',
    disabledEnded: 'This session has ended. Resume it or start a new one.',
  },

  transcript: {
    region: 'Conversation',
    stopped: 'Stopped',
    unknown: 'Unrecognised event',
    crash: 'This card could not be shown',
    crashDetail: 'The rest of the conversation is fine. Raw data:',
    local: 'Local command',
    jumpLabel: 'Jump to latest',
  },

  crashed: {
    title: 'The session stopped unexpectedly',
    detail: 'Your conversation is saved. You can pick up where it left off.',
    resume: 'Resume session',
  },

  splash: { text: 'Starting…' },

  onboarding: {
    cliMissing: {
      title: 'Claude Code is not installed',
      body: 'This app drives the Claude Code command-line tool. Install it, then check again.',
      command: 'npm install -g @anthropic-ai/claude-code',
    },
    cliOld: {
      title: 'Claude Code is too old',
      body: 'Update it, then check again.',
      command: 'claude update',
    },
    notLoggedIn: {
      title: 'Sign in to Claude',
      body: 'Run this in a terminal. The app never sees your credentials.',
      command: 'claude auth login',
    },
    check: 'Check again',
    copy: 'Copy command',
    copied: 'Copied',
  },

  picker: {
    title: 'Choose a project',
    recent: 'Recent projects',
    running: 'Running now',
    browse: 'Browse for a folder',
    path: 'Folder path',
    open: 'Open',
    trustTitle: 'Do you trust this folder?',
    trustBody: 'Claude can read files here and, with your permission, change them and run commands.',
    trust: 'Yes, I trust it',
    back: 'Back',
  },

  empty: {
    title: 'What should we work on?',
    memory: 'Project instructions found',
    starters: ['Explain how this project is organised', 'Find and fix a failing test', 'Review my uncommitted changes'],
  },

  markdown: { copy: 'Copy', copied: 'Copied', image: 'image', table: 'Table' },

  notify: {
    permission: 'Claude needs your approval',
    question: 'Claude has a question',
    done: 'Claude finished',
    limit: 'Usage limit reached',
    error: 'Something went wrong',
  },

  edit: {
    button: 'Edit command…',
    label: 'Command to run',
    allowEdited: 'Allow edited command',
    cancel: 'Keep original',
  },

  diff: { preview: 'Change preview', full: 'Change', open: 'Open details', added: (n: number) => `+${n}`, removed: (n: number) => `−${n}` },

  shortcuts: { modeChanged: (mode: string) => `Permissions: ${mode}` },

  inspector: { title: 'Details', close: 'Close details', cut: (shown: string, total: string) => `Showing the first ${shown} of ${total} characters.` },
};
