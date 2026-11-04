# Alfred

Alfred is a macOS desktop app for running several Claude Code and Codex CLI sessions across projects. Each session is the agent's own CLI in a terminal inside the window. Around the terminals Alfred shows which session is working, which one waits for you, and where each agent is making its changes.

## What it does

- **Projects and sessions.** The rail lists your projects. Under the active one you see its live sessions as a tree, with a state glyph and the latest step for each. Codex, Claude and plain shell sessions run side by side.
- **Needs you.** Sessions waiting on an approval, a question or a runtime blocker such as a failed login are collected in one list and counted in the top bar.
- **Details (⌘I).** For the focused session: the folder and git branch it actually works in, and its recent activity.
- **History.** Past sessions started in Alfred, plus Claude Code and Codex CLI sessions found on the machine. You can read a transcript or resume a session.
- **Preview.** A tab that shows a local dev server a session started, inside that session's box.
- **Workers.** A top-level Claude or Codex session gets MCP tools (`start_worker`, `list_workers`, `read_worker`, `wait_for_worker`, `send_to_worker`, `stop_worker`) to hand tasks to up to four worker sessions. Workers appear under their parent in the rail.
- **Worktrees.** In a git project, the New session sheet can start Claude or Codex with its own `--worktree` flag. The agent creates and manages the worktree; Alfred only shows where the session works. The option is checked by default when another agent session is already running in the project.
- **Plan with Alfred.** Describe a goal and get draft sessions to review and launch. It needs an `OPENROUTER_API_KEY` and is hidden without one.

Session state comes from Claude Code hooks and Codex hooks and notifications. Codex asks you to trust Alfred's hooks once (`/hooks` in Codex). Without them Alfred falls back to reading the terminal output.

## Data and privacy

Everything stays on the Mac. Alfred has no account, server or sync.

- State is saved in `~/Library/Application Support/Alfred/desktop-state.json`, with the previous save kept as `desktop-state.json.bak`.
- Saved terminal output can be turned off or cleared in Settings. When it is off, a session keeps only its name, folder and conversation, so it can still be resumed.
- Before anything is written to disk, detected secrets (tokens, keys, passwords in URLs and arguments) are replaced with `[redacted]`.
- While saved terminal output is on, agent telemetry events are also logged per day under `agent-events/` in the same folder.

## Architecture

- `apps/desktop` holds the Electron main process, the preload bridge and the React/Vite renderer.
  - The main process owns terminals (node-pty), projects, saved state, agent hooks and the worker tools.
  - The renderer draws the window. It reaches the main process only through the typed IPC API that the preload bridge exposes, with context isolation on and Node integration off.
- `packages/schema` holds the shared Zod contracts and the redactor.

## Setup

You need Node 22 and pnpm 10, as pinned in `package.json`.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

`.env` sets `DESKTOP_PORT` (4310 by default) for the renderer dev server. Add `OPENROUTER_API_KEY` to use Plan with Alfred, and optionally `ALFRED_LLM_MODEL` to choose its model.

Start the app in development:

```bash
pnpm dev:alfred
```

This runs Electron with the renderer served from `127.0.0.1:4310`. Output lines are prefixed with `[desktop]`.

## Checks

```bash
pnpm verify:quality
```

This runs ESLint, typecheck, unit tests and the build.

```bash
pnpm smoke:electron
```

This runs the Playwright scenarios against the built Electron app. Build it first with `pnpm --filter @alfred/desktop... build`. The smoke run uses temporary home, user-data and project folders and fake `claude` and `codex` commands. It never reads your real Codex or Claude state.

`pnpm verify` runs both. Set `TURBO_FORCE=true` for a run that skips Turbo's cache.

To run the desktop unit tests one file at a time:

```bash
pnpm --filter @alfred/desktop test --no-file-parallelism --maxWorkers=1
```

On Linux the smoke run needs a display, a session bus and a UTF-8 locale:

```bash
LANG=C.UTF-8 dbus-run-session -- xvfb-run -a pnpm smoke:electron
```

Linux is supported only for running these tests.

## CI

GitHub Actions runs:

- `quality` (`pnpm verify:quality`) on Ubuntu;
- `electron-smoke` (script tests and the Electron smoke) on macOS;
- `electron-smoke-linux` under Xvfb;
- `windows-path-security`, the path-handling tests, on Windows.

Branch protection on `main` requires `quality`, `electron-smoke` and `windows-path-security`.
