# ClaudeInterface

A local web UI (later Electron) on top of Claude Code, built on the Agent SDK. **`PLAN.md` is the spec** — read it fully before the first change of a session. It holds every decision, the event contract, the design system, motion rules, the build spec (§14) and the verification log (§13). `README.md` is the user-facing summary.

## Status
Updated at the end of every finished step: date, what is done, what is next. History is in `git log`.

- **Works end to end** (2026-10-25): `npm start` opens the app; a prompt streams a formatted answer with tool cards; permissions, questions and plans are answered inline; Stop, queue, reconnect, reload re-attach, take-over from another tab, folder trust, past-session resume, usage/context gauges, subagent lanes. Proved by `npm run check` (typecheck + ~250 unit tests + ~240 e2e tests on recorded real sessions) and by `npm run smoke` (21 checks on the real SDK).
- **Done milestones:** M0 (design system and states), M1 (talk to it). **Partly done:** M2 (control), M3 (agents and sessions), M4 (all but memory prefix, MCP/elicitation, rewind). Exact lists are in PLAN.md §11.
- **Next, in order:** rewind/edit-and-resend → MCP status + elicitation form → `#` memory → M3 leftovers (sidebar search/rename/fork, lane detail, lane animation) → M5 (tabs, settings, Electron).
- **Facts about this setup that shaped the design** (PLAN.md §13.2): `result` is not the end of a session (use the SDK's `idle`); `session_init` repeats every turn; no todo tool exists in SDK sessions of CLI 2.1.310 (the todo strip stays dormant); Stop gives `error_during_execution` + `aborted_tools` and the session survives; rewind needs a persisted session and a `uuid` on the user message.

## How to work here
- A step is done when **`npm run check`** passes (typecheck → unit → e2e, stops at the first failure) and it is committed. Before calling a milestone done also run `npm run smoke` (real SDK, a few cents of usage); run it whenever `bridge/src/session.ts`, `core.ts` or `normalize.ts` changes. Never spend usage in the e2e tests: they use the bridge's `--fake` mode.
- Decisions in `PLAN.md` §1 and §14 are settled. Don't reopen them (no Next.js, no pty wrapping, no extra packages outside §14.5, no credentials handled by the app). If building proves one wrong, change `PLAN.md` in the same step and say why.
- Anything marked ⚠ in `PLAN.md` is unverified: check it against real SDK output (`npm run probe` records it as fixtures) before building UI on it, then remove the ⚠ and log the result in §13.
- Don't guess SDK shapes from memory. Use the fixtures in `bridge/test/fixtures`, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (the types are the source of truth) and https://code.claude.com/docs/en/agent-sdk/typescript.
- Before any `npm install` / `npx` / `pip install`: audit first and report risk, permissions and postinstall scripts (global CLAUDE.md protocol), install with `--ignore-scripts` and exact versions, then check the lockfile for new install scripts.
- UI conventions enforced by tests (`ui/src/conventions.test.ts`, `theme.test.ts`): colours only as tokens in `theme.css` (Tailwind aliases `bg-paper text-ink bg-card text-accent bg-attention …`); no `ease-in`, `transition-all`, `scale(0)`; a new colour needs a contrast test. Components take view models from `model.ts`, never SDK shapes. Keyboard-driven actions never animate.
- **Look at the result.** Tests did not see the card running off the screen at 420 px or the Vite error overlay; a screenshot and the overlay message did. A throwaway Playwright + Edge script (see how `e2e/server.ts` starts the bridge) is enough.
- **Tooling traps on this machine:** backslashes written through `node - <<'EOF'` scripts in the shell tool can be lost (a regex silently lost its `\s` and a test passed vacuously): edit source with the Edit/Write tools. Don't `sleep` in the shell tool; run long commands with `run_in_background`. Playwright's `webServer` orphans the Node process on Windows (that is why `e2e/server.ts` is a global setup). Node cannot read bash's `/tmp`; write outputs under the repo's `.tmp/` (git-ignored). Zustand selectors that return a new object or `[]` every call loop forever: use `useShallow` and stable constants.
- Hard rules that are easy to break by accident:
  - Only `bridge/src/normalize.ts` knows SDK message shapes (`session.ts`, `history.ts`, `preflight.ts` only call the SDK).
  - Never hardcode the tool list; unknown tools → Generic card.
  - Colours only via `theme.css` tokens, durations only via `motion.ts`/CSS variables, text only via `strings.ts`.
  - Animations only on real events; never on replayed history; respect `prefers-reduced-motion`.
  - Bridge binds `127.0.0.1` only, checks token + Origin + Host, validates every command (zod), and never lets the email/organisation from `claude auth status` out of the process.
  - Model output is never rendered as HTML; links are filtered; remote images are not loaded.
- Shell: Windows 11; PowerShell is primary, Git Bash available.
