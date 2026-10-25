# ClaudeInterface

A local web UI (later Electron) on top of Claude Code, built on the Agent SDK. **`PLAN.md` is the spec** — read it fully before the first change of a session. It holds every decision, the event contract, the design system, motion rules, the build spec (§14) and the verification log (§13).

## Status
- 2026-10-25: planning finished.
- 2026-10-25: **M1 step 1 done** (scaffold, package audit, bridge + token handshake, 7 unit + 5 e2e tests passing).
- 2026-10-25: **M1 step 2 done**: `bridge/scripts/probe.ts` ran 14 real sessions; raw messages are fixtures in `bridge/test/fixtures/`; results in PLAN.md §13.2 and folded into §2/§3. Key surprises: `result` is not the end of a session (use `session_state_changed: idle`); `session_init` repeats every turn; no todo tool exists in SDK sessions; Stop gives `error_during_execution` + `aborted_tools` and the session survives; user messages need a `uuid` (rewind key); history comes from the SDK (`listSessions`/`getSessionMessages`), not `.jsonl` parsing.
- **Next: §14.8 step 3 = M0** (design tokens `theme.css`, `motion.ts`, `/dev/tokens` page with fake events, axe check), then M1 steps 3–5. Install the UI packages audited in §14.5 as each is first used (re-check `npm view <pkg> time.modified scripts` first).
- Update this Status list at the end of every finished step: date, what's done, what's next.

## How to work here
- Follow §14.8 build order. One step at a time; a step is done when `npm test`, `npm run e2e` and `npm run typecheck` pass and it's committed.
- Decisions in `PLAN.md` §1 and §14 are settled. Don't reopen them (no Next.js, no pty wrapping, no extra packages outside §14.5, no credentials handled by the app). If building proves one wrong, change `PLAN.md` in the same step and say why.
- Anything marked ⚠ in `PLAN.md` is unverified: check it with the probe script (§14.8 step 2) before building UI on it, then remove the ⚠ and log the result in §13.
- Don't guess SDK shapes from memory. Use the probe fixtures and the TS reference: https://code.claude.com/docs/en/agent-sdk/typescript
- Before any `npm install` / `npx` / `pip install`: audit first and report risk, permissions and postinstall scripts (global CLAUDE.md protocol), then install with exact versions.
- Hard rules that are easy to break by accident:
  - Only `bridge/src/normalize.ts` knows SDK / `.jsonl` shapes.
  - Never hardcode the tool list; unknown tools → Generic card.
  - Colours only via `theme.css` tokens, durations only via `motion.ts`, text only via `strings.ts`.
  - Animations only on real events; never on replayed history; respect `prefers-reduced-motion`.
  - Bridge binds `127.0.0.1` only, checks token + Origin, validates every Command.
  - UI tests use the bridge's `--fake <fixture>` mode, never a real SDK session.
- Shell: Windows 11; PowerShell is primary, Git Bash available.
