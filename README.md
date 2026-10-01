# Alfred

Alfred is an Electron desktop command center for working with coding agents.

## Product model

Alfred is terminal-first. The desktop app keeps agent terminals at the center of
the workspace, lets the user switch between projects and sessions, and makes
session state visible without replacing the underlying command-line tools.

The Inbox contains only work that needs a decision. Sessions is a secondary
surface for finding and reading local or external agent sessions, not the
primary place to operate agents. There is no supported standalone browser
client.

## Architecture

The desktop runtime has three layers:

- The React/Vite renderer presents projects, sessions, terminal desks, the
  decision-only Inbox, and the secondary Sessions navigator.
- The Electron main process owns trusted operating-system work: terminal
  processes, workspaces, persisted desktop state, session orchestration, and
  external navigation.
- The preload bridge exposes narrow typed IPC APIs to the renderer. Electron
  runs with context isolation enabled and Node integration disabled in the
  renderer.

Everything runs locally on the Mac. There is no cloud sync, hosted API or
background service.

## Workspace

```text
apps/desktop/      Electron main process, preload bridge, and React renderer
packages/schema/   shared Zod contracts and the privacy redactor
```

## Local setup

Run commands from the repository root.

```bash
pnpm install
cp .env.example .env
```

## Desktop development

Start Electron and its renderer:

```bash
pnpm --filter @alfred/desktop dev:electron
```

The desktop renderer development server listens on `127.0.0.1:4310`; it exists
to serve the Electron window during development and is not a separate supported
client.

Start the normal development loop:

```bash
pnpm dev:alfred
```

This starts the Electron desktop app with its renderer. Output is prefixed with
`[desktop]`.

## Validation

Run the repository checks:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

When the desktop test suite needs to run serially, use:

```bash
pnpm --filter @alfred/desktop test --no-file-parallelism --maxWorkers=1
```

The product-boundary contract can be run without starting services:

```bash
node --test scripts/test/desktop-product-boundary.test.mjs
```

## Release gate

Run the complete local release gate:

    pnpm verify

It runs ESLint, typecheck, tests, build, and five Playwright Electron scenarios against a built app. Runtime assertions are the acceptance gate; privacy-safe screenshots, hashes, traces, and CSS captures are diagnostic evidence. The Electron smoke uses temporary HOME, user-data, agent-home, and workspace directories; it does not read the normal Codex or Claude state.

For a faster code-only loop use pnpm verify:quality. To rerun only the desktop smoke use pnpm smoke:electron.

GitHub Actions runs the same quality gate on Linux and the Electron smoke on macOS. The macOS job is visible as a normal failing check, but Phase E does not make it a required branch-protection check.

## Current boundaries

Electron is the only user client. Remote browser access is not part of the first
version, and there is no supported standalone browser client. The former cloud sync stack (runner, API, database and Vercel
deployment) was removed; Git history archives it, along with the deleted
browser client, if an earlier implementation ever needs to be inspected.
