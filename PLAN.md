# ClaudeInterface — Architecture, UX & Implementation Plan

A visual UI on top of Claude Code. Claude Code (via the Agent SDK, which runs the Claude Code binary) does all the work; this app only renders its event stream and sends commands back.

Planned 2026-10-25 against `claude` CLI 2.1.310. Revised 2026-10-25: UX spec, design system, responsiveness, motion, full CLI feature coverage, resilience.

> **⚠ = still unverified.** Most items were checked on 2026-10-25 against `claude --help` (CLI 2.1.310) and the TS SDK reference (`@anthropic-ai/claude-agent-sdk` 0.3.310) — see §13. The remaining ⚠ items are checked in M1 step 2.

---

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Talking to Claude Code | `@anthropic-ai/claude-agent-sdk` (TypeScript) | Same engine as the CLI, typed events, `canUseTool` for permission prompts, `interrupt()`, resume/fork. Reads the same `~/.claude` settings, skills, agents, MCP, CLAUDE.md. |
| Fallback | `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` | Same events over stdin/stdout if the SDK ever gets in the way. |
| Rejected | Wrapping the terminal UI in a pty and parsing ANSI | Breaks on every CLI update. |
| Frontend | Vite + React + TypeScript | Local single-user tool: no SSR/SEO/routing needs. |
| Next.js | **Not needed** | Nothing it offers applies here. |
| Backend | Small Node "bridge" process | A browser can't spawn processes. |
| Desktop | Browser tab on localhost first, Electron later (M5) | Backend is already Node; Tauri would need a Node sidecar. |
| Platform | Windows first | |
| Repo | npm workspaces monorepo: `shared`, `bridge`, `ui` | |
| Auth | Login happens entirely in the Claude CLI (`claude auth`). The app never reads, stores or proxies credentials. | Subscription = no `ANTHROPIC_API_KEY` in the session env. API = set it (store in OS keychain / Electron `safeStorage`). Never use `--bare` in subscription mode (it skips OAuth). |
| Branding | Own name + own palette (§6). Don't name it "Claude Code" or mimic Claude Code visuals | Per Agent SDK branding guidelines ("{Name} Powered by Claude" is allowed). |
| UI language | English strings in one `ui/src/strings.ts`; Spanish later is a second file, no i18n library | Keeps the door open without a dependency. |
| Session lifetime | Sessions live in the **bridge**, not the tab. Closing the browser does not stop a running turn; reopening reattaches and replays. | Matches CLI background behaviour; reconnect is free with event sourcing. |
| Remote/phone access | **Out of scope.** Bridge stays on `127.0.0.1`. Responsive layout exists for narrow windows/split screen, not LAN access. | Exposing a process that runs Bash needs a real auth design. |
| Packages | Audit every package before installing (per global CLAUDE.md protocol) | |

---

## 2. Architecture

```
┌─────────────── Browser / Electron window ───────────────┐
│ React UI  (pure projection of the event log)            │
│  chat · tool cards · permission cards · todo progress   │
│  subagent lanes · diff viewer · usage meter · sessions  │
└──────────────▲──────────────────────────┬───────────────┘
               │ WebSocket (UiEvent, seq) │ Command (validated at bridge)
┌──────────────┴──────────────────────────▼───────────────┐
│ Local bridge (Node, 127.0.0.1 only + random token)      │
│  SessionManager: one SDK query() per session            │
│  normalize.ts: SDK messages AND .jsonl history → UiEvent│
│  eventlog.ts: per-session append-only log, seq numbers  │
│  fs.ts: folder picker, file read for diffs, @-mentions  │
└──────────────┬──────────────────────────────────────────┘
               │ Agent SDK → Claude Code binary
               ▼
        Anthropic (subscription via CLI login, or API key)
```

### Repo layout
```
ClaudeInterface/
├─ package.json            # npm workspaces: shared, bridge, ui
├─ shared/events.ts        # UiEvent + Command types — the only bridge↔UI contract
├─ bridge/src/
│  ├─ server.ts            # ws on 127.0.0.1, token, Origin check, Command validation
│  ├─ session.ts           # SessionManager: query() per session, interrupt, canUseTool
│  ├─ normalize.ts         # SDK message + .jsonl line → UiEvent (ONLY file that knows those shapes)
│  ├─ eventlog.ts          # append, seq, replay-from(seq), output truncation
│  ├─ history.ts           # list sessions from ~/.claude/projects (delegates parsing to normalize)
│  ├─ fs.ts                # list dirs, read file (for diff preview), fuzzy file search
│  └─ preflight.ts         # CLI present? version? logged in? (onboarding)
└─ ui/src/
   ├─ strings.ts           # all user-facing text
   ├─ theme.css            # tokens (§6), light + dark
   ├─ motion.ts            # duration/easing tokens, replay guard (§8)
   ├─ ws.ts                # connect, reconnect with resume-from-seq, send Command
   ├─ store.ts             # Zustand: sessions → event log; deltas batched per frame
   ├─ shell/               # AppShell, Sidebar, TabBar, Inspector, StatusBar, CommandPalette
   ├─ transcript/          # Transcript (virtualized), Message, Markdown, JumpToLatest, Search
   ├─ composer/            # Composer, MentionPicker, SlashPicker, AttachmentTray, ModePicker
   ├─ cards/               # PermissionCard, QuestionCard, PlanReview, ElicitationCard
   ├─ states/              # Onboarding, Disconnected, RateLimited, EmptyProject, CrashBoundary
   └─ renderers/           # registry keyed by tool name
      ├─ index.ts          # get(toolName) → renderer, else Generic
      └─ Generic Bash PowerShell Edit Write Read Grep Glob Web Todo Agent Notebook Mcp .tsx
```

### Event contract (`shared/events.ts`)
Every event carries `{sessionId, seq, ts, parentId?}`. `seq` is monotonic per session → reconnect asks "replay from seq N", duplicates are dropped, out-of-order is detectable.

**Bridge → UI**

| Event | Purpose |
|---|---|
| `preflight {cli, version, loggedIn, authMode}` | Onboarding screen (§7.1) |
| `session_init {tools, model, effort, mode, mcpServers, slashCommands, agents, skills, outputStyle, cwd, addDirs}` | Palettes, renderer lookup, header |
| `session_state {state}` — `idle · running · awaiting_permission · awaiting_answer · compacting · retrying · rate_limited · error · ended` | **Drives every status UI**: Stop button, tab badge, composer, notifications. Derived by the bridge from pending callbacks + `status` (compacting) + `api_retry` + `rate_limit_event` + `result`. SDK's own `session_state_changed` (only `idle·running·requires_action`, needs env `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`) is used as a cross-check. |
| `auth {state, output}` | From SDK `auth_status` → Onboarding / re-login banner |
| `user_message {id, text, images, queued?}` | Echo, incl. queued-while-running |
| `text_delta`, `thinking_delta {blockId, text}` / `block_end {blockId}` | Streaming |
| `tool_start {id, name, input, parentId}` / `tool_progress {id, elapsedSec}` / `tool_end {id, result, isError, truncated, bytes}` | Tool cards. SDK `tool_progress` is an **elapsed-time heartbeat, not output** — Bash output arrives only in the final result, so cards show a live timer, not live lines. |
| `tool_summary {ids, text}` | From SDK `tool_use_summary` → one-line label for a group of collapsed cards |
| `permission_request {reqId, tool, input, agentId, suggestions, reason, blockedPath, mcpServer}` / `permission_resolved {reqId, by}` | Cards; `resolved` closes duplicates in other windows. Fields map 1:1 to `canUseTool` options (`requestId`, `agentID`, `suggestions`, `decisionReason`, `blockedPath`, `mcpServer`); hide "Always allow" when `suppressAlwaysAllowRule`, default focus to Deny when `defaultToNo`. |
| `permission_denied {tool, reason}` | From SDK `permission_denied` (auto-denied by mode/rules) → muted row in transcript |
| `question {reqId, questions}` (AskUserQuestion, incl. `multiSelect`, `preview`) | Choice form |
| `elicitation {reqId, server, message, mode: form·url, schema?, url?}` | MCP server asking for input via `onElicitation`. `form` → generated form; `url` → "Open in browser" + "Done". Unhandled = auto-declined by SDK, so the bridge must always wire it. |
| `plan {reqId, markdown}` | ExitPlanMode review |
| `todos {items, agentId}` | Progress (TodoWrite or task tools — detected from `session_init`, never hardcoded) |
| `subagent {id, type, description, state, depth, parentTaskId, tokens, toolUses, lastTool, summary}` | Lane lifecycle, from SDK `task_started` / `task_progress` / `task_notification` (`completed·failed·stopped`) |
| `background_tasks {tasks}` | Full live set from SDK `background_tasks_changed` (replace, don't merge) |
| `hook {event, name, outcome, message}` | Timeline badge, from `hook_started` / `hook_progress` / `hook_response` (`includeHookEvents: true`) |
| `compact {trigger: auto·manual, before, after}` | From `compact_boundary` → marker in transcript (field names ⚠) |
| `usage {totalTokens, maxTokens, percentage, categories}` | Context gauge. Bridge calls `getContextUsage()` after each `result` (exact return shape ⚠) |
| `rate_limit {status: allowed·allowed_warning·rejected, resetsAt, utilization}` | From SDK `rate_limit_event.rate_limit_info` → usage meter, warning, blocked state |
| `suggestion {text}` | From SDK `prompt_suggestion` (one per turn, `promptSuggestions: true`) → chip |
| `checkpoint {userMessageId}` | Every user message's `uuid` is a rewind target (`enableFileCheckpointing: true`) |
| `retrying {attempt, …}` | From SDK `api_retry` (fields ⚠) → inline "Retrying…" |
| `conversation_reset` | From SDK `conversation_reset` (`/clear`) → divider, context gauge to 0 |
| `commands_changed` | From SDK `commands_changed` → refresh slash/palette lists |
| `notice {level, text}` | `informational`, `notification`, `model_refusal_fallback`, `model_refusal_no_fallback`, `worker_shutting_down`, `plugin_install` |
| `result {ok, errorKind?, costUsd, usage, modelUsage, durationMs, turns, fastMode?, denials}` | End of turn. `errorKind` = `max_turns · during_execution · max_budget_usd · max_structured_output_retries` |
| `error {code, message, recoverable}` | Error card / state screen |
| `unknown {raw}` | Never crash; shown only in Debug view |

**UI → Bridge** (bridge validates every Command: type, required fields, length limits, known `sessionId`/`reqId`; invalid → `error`, never forwarded)

| Command | |
|---|---|
| `start {cwd, addDirs, model, effort, mode, worktree?}` | New session |
| `resume {sessionId}` · `fork {sessionId, atMessageId?}` · `rename` · `close` · `list_sessions` | Session management |
| `prompt {text, images, mentions}` | While running → queued (default) |
| `interrupt` · `interrupt_and_send {text}` | Stop / steer |
| `permission_reply {reqId, decision: allow·deny, scope: once·session·project·user, editedInput?, reason?}` | Full permission semantics |
| `answer {reqId, answers}` · `elicitation_reply {reqId, values · declined}` · `plan_reply {reqId, approve·reject, autoAcceptEdits?, feedback?}` | Replies |
| `set_mode` · `set_model` · `set_effort` · `set_output_style` | Header controls |
| `slash {name, args}` · `compact {instructions?}` | Sent as prompt text `/name args` (⚠ confirm in M1) |
| `rewind {userMessageId, what: code·conversation·both, dryRun?}` | code → `rewindFiles(uuid, {dryRun})` (preview shows `filesChanged`, `insertions`, `deletions`); conversation → new `query()` with `resume` + `resumeSessionAt: uuid` + `forkSession: true` |
| `stop_task {taskId}` | `stopTask()` — kill background shell/agent |
| `mcp {server, action: reconnect·enable·disable}` | `reconnectMcpServer` / `toggleMcpServer` |
| `hello {token}` | Must be the first message (§14.3) |
| `replay_from {sessionId, seq}` | Reconnect |
| `fetch_full {sessionId, toolId}` | Full text of a truncated result (§14.4) |
| `trust_folder {path}` | Workspace trust (§3.5), stored by bridge |
| `fs_list {path}` · `fs_search {query}` · `fs_read {path}` (read-only, inside cwd/addDirs) | Picker, mentions, diff preview |

`parentId` = SDK `parent_tool_use_id` → nests subagent activity. If the parent isn't known (yet) the event goes to the root lane, then re-parents when the parent arrives.

---

## 3. Feature inventory (everything Claude Code exposes)

Legend: **UI** = native UI · **Palette** = runs via Ctrl+K and renders its output · **N/A** = terminal-only, replaced or skipped.

### 3.1 Conversation & tools
| Feature | Source | UI |
|---|---|---|
| Streaming text / thinking | partial messages | Text with caret; thinking collapsed into "Thought for 12s" (real time) |
| Extended thinking / effort levels | `--effort`, keywords in prompt | Effort dropdown; badge on turns that used thinking |
| Tool calls: Read, Write, Edit, MultiEdit, NotebookEdit, Bash, PowerShell, Grep, Glob, WebFetch, WebSearch, Monitor, ToolSearch, MCP tools, any future tool | `tool_use` + `tool_result` matched by id | Card per tool; Generic fallback for everything else |
| Bash/PowerShell output | tool result (contains ANSI) | Monospace block, ANSI → color via tokens, collapsible, truncated with "show full". While running: elapsed timer only (no live output in stream) |
| Background shells / agents | `background_tasks_changed`, `backgroundTasks()`, `stopTask()` | Card state "running in background" → status bar chip, Stop button |
| Images in results (Read on PNG, screenshots) | image content blocks | Inline thumbnail → lightbox |
| `!` bash mode | composer prefix | `!` in composer runs as Bash tool directly |
| `#` memory shortcut | composer prefix | `#` opens "add to memory" sheet (project/user CLAUDE.md) |
| `@` file / folder / MCP resource mentions | composer | Mention picker fed by `fs_search` + MCP resources |
| Image paste / drag-drop | composer | Attachment tray with thumbnails, remove ×, size limit |
| Output styles | `/output-style` | Header dropdown |

### 3.2 Control & permissions
| Feature | Source | UI |
|---|---|---|
| Permission prompts | `canUseTool` | **Inline card** in transcript + global "N waiting" badge. Allow once / session / project / user, Deny with reason, Edit input then allow. Diff preview for edits. |
| Permission modes | SDK: `default`, `acceptEdits`, `auto`, `plan`, `dontAsk`, `bypassPermissions` (the CLI calls `default` "`manual`"; UI label "Manual"). Live change via `setPermissionMode()`; current mode echoed in `status.permissionMode` | Header segmented control; `bypassPermissions` needs a confirm and shows a persistent warning stripe |
| Allow scopes | `PermissionUpdate.destination`: `session`, `localSettings`, `projectSettings`, `userSettings` | Scope menu: This session / This project, only me (`.claude/settings.local.json`) / This project, shared / Everywhere. Prefer SDK `suggestions` as the default choice |
| `/permissions` rules | `updateSettings()` / settings files | Settings › Permissions: list, add, remove per scope |
| AskUserQuestion | `canUseTool` | Form: single/multi select, "Other" free text, side-by-side `preview` panel |
| MCP elicitation | `onElicitation` (`form` or `url` mode) | Form generated from JSON schema, or "Open link" for `url` mode; Accept / Decline / Cancel |
| Plan mode | ExitPlanMode | Plan review card: rendered markdown, Approve (auto-accept edits) / Approve (review each) / Reject with feedback |
| Interrupt | `interrupt()` | Stop button, Esc (§9 for conflicts). Pending permission on Stop → auto-denied, card shows "cancelled" |
| Message queue while running | streaming input | Queued messages shown greyed above composer, editable/removable until sent |
| Checkpoints / rewind (Esc Esc in CLI) | `enableFileCheckpointing` + `rewindFiles(uuid, {dryRun})` for code; `resumeSessionAt` + `forkSession` for conversation | Hover a past user message → "Rewind to here" (code / conversation / both) with dry-run preview "3 files, +12 −40" + "Edit & resend". Show `skippedLinks` if > 0 |
| Sandbox ⚠ | settings | Status bar badge when active |

### 3.3 Agents & sessions
| Feature | Source | UI |
|---|---|---|
| Todo / task list | TodoWrite or Task* tools | Progress strip "3 / 7 · Running tests…" (activeForm text); per-agent lists in lanes; hidden when no list |
| Subagents | Agent tool + `parentId`, `forwardSubagentText: true`, `task_*` messages | Lanes (§7.4) with live token / tool-use counts from `task_progress`; click lane → focuses its transcript |
| Custom agents `/agents` | `session_init.agents` | Palette + Settings › Agents (read, open file) |
| Agent teams / SendMessage ⚠ | tool events | Generic card first; lanes show message arrows later |
| Background agents (`--bg`, `agents`, `attach`, `logs`, `stop`, `rm`) | CLI; `claude agents --json` lists them without a TTY | Running-agents dashboard (M5): list from `agents --json`, Stop / Delete via CLI, "Open here" = SDK `resume` once stopped |
| Sessions: resume / continue / fork / name | SDK + `.jsonl` | Sidebar grouped by project, search, rename, "branch from here" |
| Worktrees | `--worktree` / EnterWorktree | "Isolated branch" toggle at start; worktree badge in header |
| Multiple dirs `--add-dir` | option | Header chip list, add/remove |
| Scheduled / loop / cron tasks ⚠ | tools | Generic card; dashboard later |
| `/compact`, auto-compact | system message | Compaction marker in transcript; context gauge drops visibly |
| `/clear` | slash | New session in same tab (old one stays in sidebar) |
| `/export` | log | Export transcript as Markdown / JSON (from our event log) |

### 3.4 Usage & status
| Feature | Source | UI |
|---|---|---|
| Context usage `/context` | `getContextUsage()` | Context gauge in status bar; warns at 80%, suggests `/compact`; tooltip breaks down by `categories` |
| Cost `/cost` | `result.total_cost_usd`, `modelUsage` | API mode: $ per turn/session. Subscription mode: hidden, show limits instead (mode from `accountInfo()` ⚠ fields) |
| Usage limits `/usage` | `rate_limit_event` (`allowed · allowed_warning · rejected`, `resetsAt`, `utilization`) | Meter; `allowed_warning` → butter banner; `rejected` → "Limit reached — resets 14:30", composer disabled with countdown |
| Model + fallback | `supportedModels()`, `setModel()`, `--fallback-model` ⚠ SDK option name, `model_refusal_fallback` | Model dropdown from `supportedModels()`; toast when a fallback model answers |
| Fast mode | `result.fast_mode_state` (how to toggle from SDK ⚠) | Indicator in model dropdown |
| `/status`, `/doctor` | palette | Output in a sheet |
| Custom statusline | `statusLine` command in settings | Run the user's command via bridge, show its text in status bar (strip ANSI → tokens) |
| Hooks | `includeHookEvents: true` → `hook_started/progress/response` | Small badge on the turn/tool it fired on; blocked-by-hook → card shows hook message |
| Notifications | SDK `notification` message + our own state | OS notification on: permission waiting, question, turn done, error — only when window not focused |
| Prompt suggestions | `promptSuggestions: true` → `prompt_suggestion` (one per turn) | One chip above composer, Tab to accept |

### 3.5 Configuration & extensions
| Feature | UI |
|---|---|
| Slash commands, skills, plugins | Ctrl+K palette from `session_init`; `/` in composer opens same list inline |
| MCP servers `/mcp` | `mcpServerStatus()` → status dots (connected / failed / needs auth); Reconnect / Enable / Disable buttons (`reconnectMcpServer`, `toggleMcpServer`); OAuth sign-in flow ⚠ |
| Slash commands / agents lists | `supportedCommands()`, `supportedAgents()`, refreshed on `commands_changed` |
| MCP prompts (`/mcp__server__prompt`) | Listed in slash picker |
| CLAUDE.md / memory `/memory` | Editor sheet (project / user / local), plain textarea + markdown preview |
| `/init` | Palette; result shows as normal turn |
| `/config`, settings.json | Settings view: model, theme, notifications, permissions, env (no credentials ever) |
| `/login`, `/logout` | Preflight runs `claude auth status`; Onboarding shows the exact `claude auth login` command to run; app never handles credentials |
| Workspace trust | **The trust dialog is skipped in SDK/print mode** (per `claude --help`), so the app's project picker must ask "Do you trust this folder?" itself before the first `query()` in a new folder |
| `/review`, `/security-review`, other built-in skills | Palette → normal turn |
| `/vim`, `/terminal-setup`, `/ide`, keybindings.json | **N/A** — terminal concepts. Our own keyboard map (§9) |

**Rule for anything not listed:** it either arrives as a tool (→ Generic card), as a system message (→ `notice` or `unknown`), or as a slash command (→ palette). Nothing new needs UI code to *not break*; only to look nice.

---

## 4. Rules (scalability / future harness changes)

1. **Event-sourced:** bridge appends normalized events per session with `seq`; UI renders the log. Gives reconnect, replay, multi-window, debugging.
2. **Only `normalize.ts` knows SDK and `.jsonl` shapes.** A CLI update = fix one file. Unknown events → `unknown`, logged, never crash.
3. **Never hardcode the tool list.** Read it from `session_init`; unknown tools use the Generic card. Fancy renderers are opt-in.
4. **One `query()` per session** → multi-session for free.
5. **Virtualized transcript** (`react-virtuoso`) for long sessions.
6. **Security (non-negotiable):** bridge can run Bash → bind `127.0.0.1`, random token, check `Origin`, validate every Command, `fs_*` restricted to cwd + addDirs, read-only.
7. **Animations follow real events only** (tool start/end/fail, subagent spawn, permission waiting). No fake progress. Respect `prefers-reduced-motion`. Replayed history never animates.
8. **Resilience over polish:** §10 is a checklist each renderer must pass.

### Stack
- UI: Vite, React, TS, Tailwind (tokens from §6) + shadcn/ui, Motion (Framer Motion), Zustand, react-virtuoso, react-markdown + Shiki (custom theme from tokens), diff2html (Monaco only lazy-loaded for "open full diff"), an ANSI→HTML converter (pick at audit time), xterm.js not needed
- Bridge: Node, `ws`, `@anthropic-ai/claude-agent-sdk`
- Later: Electron

---

## 5. UX principles
1. **The user always knows what Claude is doing and whether it needs them.** `session_state` is visible in 3 places: tab badge, status bar, composer.
2. **Needs-you beats everything.** Permission/question/plan cards get the attention colour (`--attention`) and a notification; nothing else uses that colour.
3. **Never block reading.** No modal for anything Claude-initiated; cards are inline and the transcript stays scrollable. Modals only for user-initiated destructive actions (bypass mode, delete session).
4. **Calm by default.** Tool cards collapse to one line when done; details on demand.
5. **Every state has a screen.** §7.1 lists them; none may render blank.

---

## 6. Design system

### 6.1 Palette (given)
| Name | Hex | Role |
|---|---|---|
| Cream | `#FAF8F1` | Light background / dark-mode text |
| Butter | `#FAEAB1` | **Attention** (needs you), highlights, selection, active todo |
| Teal | `#34656D` | Primary: buttons, links, focus ring, running state, user bubble |
| Pine | `#334443` | Light-mode text, dark-mode raised surfaces |

### 6.2 Tokens (`ui/src/theme.css`)
Derived colours are added only where the palette has no answer (error, warning, dark background, teal readable on dark). Contrast checked (WCAG 2.x):

| Token | Light | Dark | Use | Contrast |
|---|---|---|---|---|
| `--bg` | `#FAF8F1` | `#1F2A29` | Page | — |
| `--surface` | `#FFFFFF` | `#2A3836` | Cards, composer | — |
| `--surface-sunken` | `#F2EFE4` | `#18211F` | Code blocks, terminal | — |
| `--text` | `#334443` | `#FAF8F1` | Body | 9.65 / 13.90 |
| `--text-muted` | `#5E6B69` | `#9AA8A6` | Meta, timestamps | 5.22 / 6.00 |
| `--primary` | `#34656D` | `#7FB3BA` | Links, focus, running | 6.12 / 6.37 |
| `--primary-fill` | `#34656D` | `#34656D` | Button bg (text `#FAF8F1`) | 6.12 |
| `--attention` | `#FAEAB1` | `#FAEAB1` | Needs-you bg (text `#334443` / `#1F2A29`) | 8.53 / 12.29 |
| `--danger` | `#B4483C` | `#E8917F` | Errors, deny, failed tool | 5.02 / 6.18 |
| `--warning` | `#8A6A12` | `#FAEAB1` | Warnings (text only + icon) | 4.76 / 12.29 |
| `--border` | `#334443` @ 12% | `#FAF8F1` @ 12% | Dividers (decorative) | — |

- Teal `#34656D` as *text* on dark is 2.27:1 → never used as text in dark mode; dark uses `#7FB3BA`.
- Status never by colour alone: icon + label (✓ done, ✗ failed, ● running, ◆ needs you).
- Dark mode: `@media (prefers-color-scheme: dark)` + manual override `[data-theme]`; preference stored in localStorage (try/catch).
- Shiki: one custom theme per mode built from these tokens; diff add/remove use `--primary` / `--danger` tints at 12%.
- Bash ANSI colours mapped to tokens (red → `--danger`, green → `--primary`, yellow → `--warning`), not raw ANSI hex.

### 6.3 Type, space, shape
- Sans: `"Segoe UI Variable", system-ui, sans-serif`. Mono: `"Cascadia Code", "Cascadia Mono", Consolas, monospace` (ship with Windows, no font download).
- Scale: 12 / 13 / 14 (body) / 16 / 20 / 24. Line height 1.5 body, 1.4 code.
- Spacing 4-px grid: 4 8 12 16 24 32. Radius: 6 (controls), 10 (cards), 999 (chips).
- Density toggle (comfortable / compact) only changes spacing tokens.

---

## 7. Screens, layout & responsiveness

### 7.1 State inventory (every one needs a design)
| State | Screen |
|---|---|
| Bridge starting | Splash with logo pulse (real: until ws connects) |
| CLI missing / too old | Onboarding: what to install, exact command, "Check again" |
| Not logged in | Onboarding: "Run `claude auth login` in a terminal", "Check again" |
| No project chosen | Project picker: recent projects (from `~/.claude/projects`), folder browser via `fs_list`, workspace-trust confirm for new folders |
| Empty session | Composer focused, suggested starters, project's CLAUDE.md summary |
| Running / waiting / done | Normal transcript |
| Disconnected | Top banner "Reconnecting…" with attempt count; transcript stays readable; composer disabled, draft kept |
| Rate limited | Banner + countdown to reset; composer disabled |
| API overloaded / retrying | Inline notice in transcript "Retrying (2/10)…" |
| Session crashed | Error card with message + "Resume session" |
| Renderer crash | Per-card error boundary → Generic card with raw JSON; rest of transcript unaffected |
| Huge / unknown event | Collapsed "Unrecognised event" row, Debug view only |

### 7.2 Layout regions
```
┌────────┬──────────────────────────────────────┬──────────────┐
│Sidebar │ Header: project · model · mode · ctx │  Inspector   │
│sessions│──────────────────────────────────────│  diff / file │
│by      │ Lanes strip (only if subagents)      │  plan / todo │
│project │──────────────────────────────────────│  subagent    │
│        │ Transcript (virtualized)             │  detail      │
│        │                                      │              │
│        │ Todo strip · queued msgs · chips     │              │
│        │ Composer                             │              │
├────────┴──────────────────────────────────────┴──────────────┤
│ Status bar: state · ctx gauge · usage · bg tasks · statusline│
└──────────────────────────────────────────────────────────────┘
```
- Transcript content max-width 780 px, centred in its column (readability).
- Inspector opens when a card's "Open" is clicked (diff, full output, plan) and is resizable; closed by default.
- Tabs (M5) sit above the header; each tab = one session with a state badge.

### 7.3 Breakpoints (container-driven, mobile-first CSS)
| Width | Layout |
|---|---|
| **≥ 1440** | Sidebar (260, collapsible) + transcript + inspector docked (420, resizable) |
| **1024–1439** | Sidebar collapsible to icon rail (56); inspector docked when open, transcript shrinks to min 560 then inspector becomes overlay |
| **720–1023** | Sidebar = slide-over drawer (hamburger); inspector = right overlay sheet (80% width); lanes strip scrolls horizontally |
| **< 720** (narrow window, split screen) | Single column; header condenses to project + state + overflow menu; inspector = full-screen sheet with back; permission/question cards stick to bottom above composer; status bar folds into header menu |

- Cards use **container queries**, not viewport queries — a card in a 420-px inspector and in a 780-px transcript lays itself out from its own width.
- Long content never widens the page: code/terminal blocks scroll horizontally inside themselves; paths middle-truncate (`C:\Users\…\src\store.ts`) with full path in tooltip; `overflow-wrap: anywhere` on prose.
- Touch/pointer: hit targets ≥ 32 px (mouse) / 44 px when `(pointer: coarse)`; hover-only actions also reachable by focus and an overflow button.
- Height: composer grows to 40% of viewport then scrolls; uses `dvh`, not `vh`.
- Resizable panes remember width per breakpoint (localStorage, try/catch).

### 7.4 Key components
- **Tool card**: one line `icon · tool · short target · elapsed · status`. Expand → body (renderer). Failed → stays expanded, `--danger` left rule. Nested subagent tools indented under their Agent card.
- **Permission card**: `--attention` background, what/where in plain words ("Edit `src/store.ts` (+12 −3)"), diff preview, buttons Allow · Allow for… (scope menu) · Deny…  (reason field). Keyboard: `Y` allow, `N` deny, `A` allow-always menu when focused.
- **Lanes strip**: one pill per active subagent `type · description · ● state · tool count`; >6 lanes → "+N" overflow menu; nested agents shown as indented in the overflow list. Finished lanes collapse after 4 s (real completion).
- **Todo strip**: segmented bar, one segment per item (done = teal, in progress = butter, pending = outline) + "3 / 7 · activeForm". Click → inspector list.
- **Context gauge**: ring in status bar, teal → warning at 80% → danger at 95%, tooltip with token numbers; compaction shown as drop + marker in transcript.
- **Jump-to-latest pill**: appears when user scrolled up and new events arrive; shows count.

---

## 8. Motion system

### 8.1 Tokens (`ui/src/motion.ts`)
| Token | Value | Use |
|---|---|---|
| `instant` | 100 ms | Hover, press, colour change |
| `quick` | 160 ms | Card expand, chip enter, toast |
| `base` | 240 ms | Panel/sheet open, lane spawn |
| `slow` | 360 ms | Layout reflow of lanes, rare |
| `ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Enter |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exit (exits are ~20% faster than enters) |
| `spring` | stiffness 400, damping 32 | Progress fills, drag/resize settle |

### 8.2 What animates (each tied to a real event)
| Trigger (event) | Animation |
|---|---|
| `text_delta` | Text appears per frame batch (no per-character typewriter); blinking caret at end while block open |
| `thinking_delta` | "Thinking" label with a subtle shimmer **only while deltas arrive**; stops on `block_end` |
| `tool_start` | Card fades + slides up 4 px (`quick`); status icon spinner |
| `tool_end` ok | Spinner morphs to ✓ (scale 0.8→1, `quick`); card collapses to one line after 600 ms |
| `tool_end` error | ✗ + one horizontal shake 4 px (`quick`), left rule turns `--danger` |
| `permission_request` | Card enters with `base`; one attention glow pulse (not looping); tab badge pops |
| `permission_resolved` | Buttons collapse into the decision chip ("Allowed for session") |
| `subagent` spawn / end | Lane pill grows from its parent Agent card position (shared layout animation); on end fades + strip reflows (`slow`) |
| `todos` change | Segment fill springs; completed item check draws in |
| `usage` | Gauge arc springs to new value |
| `compact` | Gauge drains; marker line draws across transcript |
| `session_state` change | Status dot cross-fades colour; running = slow 2 s breathing dot (stops when not running) |
| `suggestions` | Chips stagger in 30 ms each, max 3 |
| User actions | Sheets slide from their edge (`base`), drawers push, press = scale 0.97 |

### 8.3 Motion rules
- Animate only `transform` and `opacity` (plus colour). Never animate height of the virtualized list items — expand uses Motion `layout` on the card only, list re-measures after.
- **Replay guard:** events delivered by `replay_from`/resume, and any event older than 2 s on arrival, render with no animation.
- **Burst guard:** if more than 10 events of the same kind arrive within one 100-ms window (e.g. 50 Read calls), skip enter animations for that batch.
- All animations interruptible: a new state cancels the old one, never queues.
- Off-screen items never animate (virtuoso unmounts them anyway).
- `prefers-reduced-motion: reduce` → no movement, no shimmer, no shake; only 100-ms opacity fades. Breathing dot becomes static.
- Background tab (`document.hidden`) → no animation work; catch up instantly on focus.

---

## 9. Interaction, keyboard & accessibility

### 9.1 Composer
- Enter send · Shift+Enter newline · ↑ in empty composer = previous prompt · Esc in composer with text = blur, not stop.
- While running: Enter **queues**; Ctrl+Enter = interrupt and send now.
- Prefixes: `/` slash picker · `@` mentions · `!` bash · `#` memory.
- Draft saved per session (survives reload). Paste image → attachment; paste > 10 KB text → offered as attachment chip.

### 9.2 Global keyboard map
| Key | Action |
|---|---|
| Esc | Priority: close open popover/sheet → else stop running turn (when transcript or composer is focused) |
| Esc Esc | Rewind picker |
| Ctrl+K | Command palette |
| Ctrl+F | Transcript search (our own; virtualized list breaks browser find) |
| Ctrl+B | Toggle sidebar |
| Ctrl+I | Toggle inspector |
| Ctrl+Shift+M | Cycle permission mode |
| Alt+↑ / Alt+↓ | Jump to previous/next needs-you card |
| Ctrl+1…9 | Switch tab (M5) |
| Y / N / A | Permission card focused: allow / deny / allow-always menu |
`?` shows this map. All shortcuts listed in palette too.

### 9.3 Accessibility
- Streaming text: `aria-live` region announces **once per finished block**, not per token. Needs-you cards: `role="alert"` once.
- Focus: new permission card does **not** steal focus while user is typing; it's announced and reachable with Alt+↑. After answering, focus returns to composer.
- Every icon button has a label; focus ring 2 px `--primary` with 2 px offset, always visible on keyboard focus.
- Full keyboard path for every flow (pick project → prompt → approve → review diff).
- Respects OS high-contrast / `forced-colors`: borders become `CanvasText`.
- Zoom to 200% stays usable (breakpoints are container/width based, so it just drops a layout tier).

---

## 10. Resilience — things that can break the UI and the guard for each

| Risk | Guard |
|---|---|
| New/unknown SDK event | `normalize` → `unknown`; UI ignores outside Debug view |
| New/unknown tool | Generic card: name + pretty JSON input + text result |
| Tool input/result not the expected shape | Each renderer checks fields it reads; missing → falls back to Generic. Error boundary per card |
| Huge output (MB of Bash, big file Read) | Bridge truncates to 64 KB per result over WS (`truncated`, `bytes`), full text fetched on "show full" |
| Very long lines / no spaces / minified JSON | Horizontal scroll inside block, `overflow-wrap: anywhere` in prose |
| ANSI escapes, `\r` progress bars, control chars | ANSI converter; collapse `\r` overwrites; strip other C0 controls |
| Binary / invalid UTF-8 output | Show "binary output (N bytes)" |
| Emoji, CJK, RTL, Spanish accents | System fonts cover them; `dir="auto"` on message blocks |
| Unclosed markdown fence mid-stream | Temporarily close open fences before rendering partial text |
| Very fast delta stream | Deltas buffered and flushed to store once per animation frame |
| Out-of-order / duplicate events | `seq` dedupe; `tool_end` before `tool_start` → create card in ended state |
| Orphan `parentId` | Attach to root lane; re-parent when parent appears |
| 50+ parallel subagents / deep nesting | Lanes overflow menu; nesting indentation capped at 3 levels then flattened with breadcrumb |
| 10k+ message session | Virtualized; Shiki highlighting lazy for visible blocks only |
| Two windows on same session | Both get events; first reply wins, `permission_resolved` closes the other card |
| Bridge restart | UI shows Disconnected → reconnect → `resume` from `.jsonl` |
| Session switch mid-stream | Store is keyed by sessionId; background sessions keep receiving |
| Permission request while user away | OS notification; request waits (no timeout) and tab/title badge shows ◆ |
| Huge pasted prompt / image | Composer limits: warn above 100 KB text; images downscaled client-side above 2000 px |
| Model/limits change mid-session | `notice` toast + header updates from event, never from local assumption |
| localStorage blocked | All reads/writes try/catch; defaults used |

`bridge/test/fixtures/` holds recorded SDK streams **plus** hand-made hostile ones (each row above) that `normalize` and a UI smoke test must survive.

---

## 11. Milestones

### M0 — UX spec (before UI code)
1. Low-fi wireframes for: onboarding, project picker, empty session, running transcript with tool cards, permission card, plan review, lanes, narrow (<720) layout.
2. `theme.css` + `motion.ts` with the tokens from §6 and §8; a single `/dev/tokens` page showing every token, both themes, and every card state with fake events.
3. Keyboard map (§9.2) confirmed.

**Done when:** the dev page renders every state in §7.1 at all 4 breakpoints in light and dark, and passes an axe check with zero contrast errors.

### M1 — Talk to it
1. Audit packages (report risk / permissions / postinstall), then scaffold workspaces.
2. Verify the remaining ⚠ items (§13) with a throwaway script that prints raw SDK messages: `compact_boundary`/`api_retry` fields, `getContextUsage()` and `accountInfo()` shapes, slash commands as prompt text, fallback-model option, fast-mode toggle, MCP OAuth, agent teams, scheduled tasks, sandbox. Record a fixture of each message seen.
3. Bridge: ws server → `query()` with streaming input + partial messages → `normalize` → `eventlog` with `seq`. Preflight.
4. UI: shell layout (responsive), Onboarding + project picker, Composer (send, queue, Stop), Transcript with auto-scroll + jump-to-latest, Generic tool card, Disconnected state.
5. Test: recorded + hostile fixtures through `normalize`, assert events.

**Done when:** from `npm start` the browser opens authenticated, a new user reaches their first streamed answer without reading docs, Read/Bash show live cards, Stop interrupts, killing the bridge shows Disconnected and recovers, and it runs on the subscription with no API key set.

### M2 — Control
Permission card (all scopes, deny with reason, edit input), AskUserQuestion form (multi-select, Other, preview), plan review, todo strip, mode switcher, message queue, notifications, session_state everywhere, motion for these events.

**Done when:** in `manual` mode every write asks inline with a diff preview, Y/N works from the keyboard, the todo strip advances as items complete, and a permission request while the window is unfocused fires an OS notification.

### M3 — Agents & sessions
Subagent lanes with layout animation, session sidebar (resume/fork/rename/search), `.jsonl` history through `normalize`, usage/context gauge, compaction marker, rate-limit state, background shells.

**Done when:** a task spawning 2 subagents shows 2 live lanes that collapse when done, reopening the app resumes the session with no replay animation, and the context gauge moves every turn.

### M4 — Rich tools
Edit/Write/MultiEdit diff (diff2html, CRLF-safe), Bash/PowerShell ANSI output, Read preview + images, Ctrl+K palette and `/` picker from `session_init`, `@` mentions, `!` and `#` prefixes, image paste, MCP status + elicitation, transcript search, export, rewind/edit-and-resend.

**Done when:** every hostile fixture in §10 renders without a crash or horizontal page scroll at 360 px wide.

### M5 — Ship-shape
Multiple tabs with state badges, background agents dashboard, settings & memory editors, custom statusline, Electron wrapper (`safeStorage` for API key mode), density toggle.

**Done when:** 3 sessions run in parallel, the one needing permission is identifiable from the tab bar alone, and the Electron build starts on a clean Windows machine.

---

## 12. Open items
- Remaining ⚠ items (§13, resolved in M1 step 2).
- Product name and logo (needed before M5; placeholder until then).
- ANSI converter and diff library choice — decided at the package audit.
- Spanish UI strings — after M5, by adding a second strings file.

---

## 13. Verification log (2026-10-25)
Sources: `claude --help`, `claude auth --help`, `claude agents --help` (CLI 2.1.310); TS SDK reference at code.claude.com/docs/en/agent-sdk/typescript; `npm view @anthropic-ai/claude-agent-sdk` → 0.3.310.

| Item | Result | Plan change |
|---|---|---|
| Option names | ✅ `canUseTool`, `includePartialMessages`, `permissionMode`, `effort` (`low·medium·high·xhigh·max`), `model`, `forwardSubagentText`, `includeHookEvents`, `promptSuggestions`, `enableFileCheckpointing`, `onElicitation`, `resume`, `resumeSessionAt`, `forkSession`, `additionalDirectories`, `abortController` | — |
| Permission mode names | ⚠→✅ SDK uses `default`; CLI flag calls it `manual` | Contract uses `default`, UI label "Manual" |
| `canUseTool` result | ✅ allow `{updatedInput, updatedPermissions}` / deny `{message, interrupt}` | Edit-input-then-allow and deny-with-reason are both native |
| Allow scopes | ✅ destinations `session · localSettings · projectSettings · userSettings · cliArg` | Scope menu mapped (§3.2) |
| `canUseTool` options | ✅ also `decisionReason`, `blockedPath`, `mcpServer`, `defaultToNo`, `suppressAlwaysAllowRule` | Permission card uses them |
| `tool_progress` | ❗ exists but is an elapsed-time heartbeat, not output | No live Bash output; card shows timer |
| Subagents | ✅ `task_started / task_progress / task_notification`, `parent_task_id`, `spawn_depth` | Lanes get real counts and nesting |
| Background tasks | ✅ `background_tasks_changed` (full set), `backgroundTasks()`, `stopTask()` | Status-bar chips + Stop |
| Rate limits | ✅ `rate_limit_event.rate_limit_info {status, resetsAt, utilization}` | Usage meter + blocked state |
| Session state | ✅ `session_state_changed` but only 3 states and needs `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` | Bridge derives the richer state itself |
| Compacting | ✅ `status {status: "compacting"}`, `compact_boundary` exists | Field names of `compact_boundary` still ⚠ |
| Rewind | ✅ `rewindFiles(uuid, {dryRun})` → `{canRewind, filesChanged, insertions, deletions, skippedLinks}`; conversation via `resumeSessionAt` | Rewind moved out of "maybe" |
| Elicitation | ✅ `onElicitation`; modes `form · url`; unhandled = auto-decline | Always wired |
| Prompt suggestions | ✅ one `prompt_suggestion {suggestion}` per turn | One chip, not several |
| Hooks | ✅ `hook_started / hook_progress / hook_response` | — |
| Auth | ✅ `claude auth status`; SDK `auth_status` message | Preflight + re-login banner |
| Workspace trust | ❗ skipped in SDK/print mode | App asks itself in project picker |
| Background agents CLI | ✅ `claude agents --json` works without a TTY | Dashboard reads it |
| Context usage | ✅ `getContextUsage()` exists | Return shape ⚠ |
| Other Query methods | ✅ `setModel`, `supportedModels/Commands/Agents`, `mcpServerStatus`, `reconnectMcpServer`, `toggleMcpServer`, `updateSettings`, `accountInfo`, `readFile`, `streamInput`, `close` | Wired into §3 |
| Still ⚠ | `compact_boundary` / `api_retry` / `notification` fields, `getContextUsage()` and `accountInfo()` shapes, `ElicitationResult` exact shape, slash commands as prompt text, `--fallback-model` SDK option, fast-mode toggle, MCP OAuth from SDK, agent teams, scheduled tasks, sandbox status | M1 step 2 |

---

## 14. Build spec (for whoever implements this)
Everything below is decided. Don't reopen it without a concrete reason found while building; if you change something, update this file in the same step.

### 14.1 Environment
- Windows 11, Node **24.22.0**, npm 11.19.1, git 2.56, `claude` CLI 2.1.310 (all present on the machine as of 2026-10-25).
- `"engines": {"node": ">=24"}`, ESM everywhere (`"type": "module"`), TypeScript `strict: true`.
- Not a git repo yet → step 1 runs `git init`, adds `.gitignore` (`node_modules`, `dist`, `*.log`, `.env*`), then commits after every finished step.

### 14.2 One process, one port
- `npm run dev` → `tsx watch bridge/src/main.ts --dev`. In dev, the bridge runs **Vite in middleware mode** inside its own HTTP server, so UI, HMR and WebSocket share one origin. No second terminal, no `concurrently`.
- `npm start` → builds `ui` and runs the bridge, which serves `ui/dist` statically.
- Port: `127.0.0.1:4317`, override with env `CLAUDEINTERFACE_PORT`. Port busy → exit with a clear message (don't pick a random port silently).
- WebSocket path: `/ws`. Vite's HMR socket shares the server; `attachWs` only handles `/ws` and leaves every other upgrade to Vite.
- Flags: `--dev` (Vite middleware), `--no-open` (don't launch the browser).
- `npm run dev` uses `tsx watch`, for a human at a terminal: **every bridge restart creates a new token**, so reopen the printed link. `tsx watch` hangs when stdin is a pipe (found in step 1), so anything automated (Playwright, scripts) runs `npx tsx bridge/src/main.ts --dev --no-open` instead.
- Every HTTP request is checked against the `Host` header (`127.0.0.1:<port>` / `localhost:<port>`), which blocks DNS rebinding; WS upgrades are checked against `Origin`.

### 14.3 Token flow
1. Bridge creates a 32-byte random hex token at startup (`crypto.randomBytes`), kept in memory only.
2. Bridge prints and opens `http://127.0.0.1:4317/#t=<token>` (open with `start ""` on Windows via `child_process`, no `open` package).
3. UI reads `location.hash`, saves the token in `sessionStorage` (try/catch), then `history.replaceState` removes the hash so it isn't kept in the URL.
4. The first WS message must be `{type: "hello", token}`; otherwise the bridge closes the socket after 2 s. Compare with `crypto.timingSafeEqual`.
5. Reject upgrades whose `Origin` isn't `http://127.0.0.1:4317` or `http://localhost:4317`.
6. Lost token (new tab without hash, or a stale one after a bridge restart) → "Open the link printed in the terminal" screen. Typing `url` + Enter in the bridge terminal prints the link again (a second process can't know the in-memory token, so there is no `--print-url` flag).
7. Wrong or missing hello → the bridge closes the socket with code **4401**; the UI reads 4401 as "link invalid". Env `CLAUDEINTERFACE_TOKEN` (≥ 32 hex chars) overrides the random token **for tests only**.

### 14.4 Data and persistence
- Live event log: in memory in the bridge, one array per session. After a bridge restart, sessions are rebuilt from the CLI's own `~/.claude/projects/*.jsonl` through `normalize.ts`. The app writes **no** transcript files of its own.
- Tool results longer than 64 KB are stored whole in the bridge log, but sent truncated; `fetch_full {sessionId, toolId}` command returns the full text.
- UI preferences (theme, density, pane widths, drafts, last project): `localStorage`, every access in try/catch.
- Trusted folders: `%APPDATA%\ClaudeInterface\trusted.json` (list of absolute paths), written by the bridge only.
- Credentials: never stored by the app (§1 Auth).

### 14.5 Packages to audit (then install)
Follow the global CLAUDE.md protocol: report risk / permissions / postinstall for each **before** installing. Resolve current versions with `npm view <pkg> version` at that time and pin exact versions (`--save-exact`). Record the table of pinned versions in §13.

| Where | Runtime | Dev |
|---|---|---|
| bridge | `@anthropic-ai/claude-agent-sdk`, `ws` | `tsx`, `typescript`, `@types/ws`, `@types/node` |
| ui | `react`, `react-dom`, `zustand`, `react-virtuoso`, `motion`, `react-markdown`, `remark-gfm`, `shiki`, `diff2html`, `lucide-react`, one ANSI→HTML lib (compare `anser` vs `ansi-to-html` in the audit) | `vite`, `@vitejs/plugin-react`, `tailwindcss` + `@tailwindcss/vite` (v4), `@types/react`, `@types/react-dom` |
| root | — | `vitest`, `@playwright/test`, `@axe-core/playwright` |
| shadcn/ui | Copy only the components needed (button, dropdown-menu, dialog, popover, tooltip, command, sheet) with the shadcn CLI via `npx` — audit the Radix packages it adds | |
| Later (M4/M5) | `monaco-editor` (lazy), `electron` | |

Nothing else without a line in this table.

**Audit done 2026-10-25 (step 1):** all 31 packages above plus the SDK's three peers (`zod`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, auto-installed by npm) and the SDK's platform binary package (`@anthropic-ai/claude-agent-sdk-win32-x64`, 297 MB, official Anthropic publisher) — **Risk: Low**. No `preinstall`/`install`/`postinstall` on any direct dependency. In the full tree of 241 packages only `esbuild` (checksum check; its binary ships as a separate package) and `fsevents` (macOS only) have install scripts; installs use `--ignore-scripts` and neither is run. `anser` chosen over `ansi-to-html` (last published 2021). `typescript` is **7.0.2** (native compiler); `tsc` works unchanged. Packages not yet installed (still audited, install when first used): `zustand`, `react-virtuoso`, `motion`, `react-markdown`, `remark-gfm`, `shiki`, `diff2html`, `lucide-react`, `anser`, `tailwindcss`, `@tailwindcss/vite`, `@axe-core/playwright`. Re-run `npm view <pkg> version time.modified scripts` right before installing them in case a newer release changed the picture.

**Installed so far (exact pins):** `@anthropic-ai/claude-agent-sdk` 0.3.310, `ws` 8.22.0, `tsx` 4.23.15, `@types/ws` 8.18.2, `vite` 8.3.5, `react` / `react-dom` 19.3.1, `@vitejs/plugin-react` 6.1.2, `@types/react` / `@types/react-dom` 19.3.0, `typescript` 7.0.2, `@types/node` 26.6.5, `vitest` 5.0.5, `@playwright/test` 1.64.1.

### 14.6 Tests
- `vitest` for `bridge/src/normalize.ts`, `eventlog.ts`, Command validation, and `ui/src/store.ts`. Fixtures in `bridge/test/fixtures/*.jsonl` (one SDK message per line): recorded real sessions + the hostile cases of §10.
- `@playwright/test` + `@axe-core/playwright` for the `/dev/tokens` page (M0) and one smoke flow per milestone, run against `npm run dev` with a **fake bridge mode** (`--fake <fixture>` replays a fixture instead of calling the SDK), so UI tests never spend tokens.
- Commands: `npm test` (vitest), `npm run e2e` (playwright), `npm run typecheck` (`tsc -p` per workspace, `--noEmit`; no project references). A step is done only when all three pass.
- E2E specs are named `*.e2e.ts` (Playwright `testMatch`) so vitest never picks them up. E2E runs on port **4318** with the fixed token in `e2e/token.ts`, using the Edge that ships with Windows (`channel: 'msedge'`), so no browser download is needed.
- Tests that need a server use port `0` (ephemeral), never a fixed port.

### 14.7 Code conventions
- Colours only through tokens in `ui/src/theme.css`; no hex anywhere else. Durations/easings only from `ui/src/motion.ts`.
- User-facing text only in `ui/src/strings.ts`.
- SDK and `.jsonl` types imported only in `bridge/src/normalize.ts` (and `session.ts` for calling `query()`). Everything else uses `shared/events.ts`.
- Named exports, one component per file, file names as in §2 layout.
- Each renderer: reads only the fields it needs, falls back to Generic if they're missing, wrapped in the per-card error boundary.

### 14.8 Build order
1. ✅ **Done 2026-10-25** — M1 step 1: `git init`, package audit, workspaces scaffold, bridge serving the UI (Vite middleware in dev, static `ui/dist` in production), token handshake (§14.2–14.3). Covered by 7 vitest tests (handshake, Origin, token) and 5 Playwright tests (link connects, hash stripped, reload, bad token, bad Host).
2. M1 step 2: SDK probe script (`bridge/scripts/probe.ts`) that runs one real `query()` with every option from §13 on, prints every raw message, and saves it as a fixture. Resolve the remaining ⚠ items, update §2 contract and §13.
3. M0 (tokens, motion, `/dev/tokens` page with fake events, axe check).
4. M1 steps 3–5, then M2 → M5 in order.
