# ClaudeInterface

A visual interface for Claude Code. Claude Code does all the work (through the Agent SDK, so it reads the same `~/.claude` settings, skills, agents, MCP servers and `CLAUDE.md` as the terminal tool); this app shows what it is doing and lets you answer when it asks.

It runs on your own machine and talks to nothing but Claude Code. Your login stays in the Claude CLI: the app never reads, stores or sends your credentials.

## Run it

You need Node 24+ and Claude Code signed in (`claude auth login` if you have not done so).

```
npm install
npm start
```

`npm start` builds the page, starts the local bridge on `127.0.0.1:4317` and opens your browser with a one-time link. If you close the tab, type `url` + Enter in that terminal to print the link again.

For development: `npm run dev` (reloads on change; every bridge restart makes a new link).

## What you get

- Streaming answers with formatted text, tool cards (what was read, run, edited) and a live status.
- Questions from Claude appear in the conversation: allow or deny a change (with a preview of the edit), pick "allow for this session / project / everywhere", answer multiple-choice questions, approve a plan.
- Stop means stop: it cancels what is waiting and the same session keeps working. Messages you send while Claude works wait in a queue you can edit.
- Sessions keep running when you close the tab. A new tab can take them over; a reload re-attaches by itself. Past conversations resume from the sidebar.
- Usage limits, context window, subagents and background tasks are shown from what Claude Code reports.
- Works from a phone-width window to a wide desktop, light and dark, keyboard-first, with reduced-motion support.

## Safety

- The bridge listens on `127.0.0.1` only, requires the one-time token, checks the `Origin` and `Host` of every connection, and validates every command it receives.
- A folder is asked about ("do you trust this folder?") before Claude can work in it, unless you already trusted it in the CLI.
- Text from the model is never rendered as HTML, links are limited to `http(s)`/`mailto`, and remote images are not loaded.
- `claude auth status` also prints your email and organisation: those are dropped inside the bridge and never reach the browser.

## Commands

| Command | What it does |
|---|---|
| `npm start` | build and run |
| `npm run dev` | development server |
| `npm run check` | typecheck, unit tests and end-to-end tests (all must pass before a change is done) |
| `npm test` / `npm run e2e` / `npm run typecheck` | the three parts of `check` |
| `npm run smoke` | drives the **real** Claude Code through the bridge (edit approved and applied, denial, Stop, queue, replay). Costs a few cents of usage |
| `npm run probe` | records raw SDK messages as fixtures (see `bridge/test/fixtures`). Costs a few cents of usage |

The end-to-end tests run against recorded real sessions (`--fake`), so `npm run check` never spends usage.

## For contributors

Read `PLAN.md` (design and decisions) and `CLAUDE.md` (working rules and current status) first. The short version: only `bridge/src/normalize.ts` knows the SDK's message shapes; the UI is a projection of an event log; colours, motion timings and text each live in exactly one file.
