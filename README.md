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

The desktop can operate locally without cloud sync. When sync and historical
run data are needed, the optional data path is:

```text
Local agent session files
        |
        v
Local runner -> Hono API -> Postgres
```

The runner normalizes supported agent records, applies privacy redaction, and
uses a SQLite outbox before sending batches to the API. The same Hono API runs
locally and on Vercel.

Vercel hosts only the API. The root `api/**` files are the Vercel function shim;
`scripts/build-vercel-api.mjs` generates `api/.generated/app.cjs`, which the
shim loads. No desktop renderer or other user client is deployed there.

## Workspace

```text
apps/desktop/      Electron main process, preload bridge, and React renderer
apps/api/          Hono API for health and device-authenticated runner ingest
apps/runner/       local source adapters, redaction, outbox, and sync loop
packages/schema/   shared Zod contracts
packages/db/       Drizzle schema and database client
packages/adapters/ source normalization helpers
api/               Vercel API adapter and generated server bundle
drizzle/           Postgres migrations and migration metadata
```

## Local setup

Run commands from the repository root.

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm exec drizzle-kit migrate --config apps/api/drizzle.config.ts
```

The example environment uses the local Postgres instance and development-only
credentials. Keep real database, authentication, and runner secrets out of the
repository.

## Desktop development

Start Electron and its renderer:

```bash
pnpm --filter @alfred/desktop dev:electron
```

The desktop renderer development server listens on `127.0.0.1:4310`; it exists
to serve the Electron window during development and is not a separate supported
client.

Start the normal integrated development loop after Postgres is ready:

```bash
pnpm dev:alfred
```

This starts the API, Electron desktop app, and fixture-backed local runner.
Output is prefixed with `[api]`, `[desktop]`, or `[runner]`. If one process
exits, the launcher stops the others. The fixture runner does not read live
agent session directories.

## API and cloud sync

Start only the API with:

```bash
API_PORT=4301 ALFRED_ALLOW_DEV_AUTH=1 pnpm --filter @alfred/api dev
```

The local API listens on `127.0.0.1:4301`. Its health route is public:

```bash
curl -sS http://127.0.0.1:4301/health
```

`ALFRED_ALLOW_DEV_AUTH=1` enables only the local static runner device-token
fallback; it does not create a human session. Runner ingest uses Bearer device
tokens at `/v1/ingest/heartbeat` and `/v1/ingest/batches`, with Vercel aliases
at `/api/v1/ingest/heartbeat` and `/api/v1/ingest/batches`.

`vercel.json` is deliberately API-only. Hosted runtime configuration requires:

- `DATABASE_URL`: pooled Postgres URL used at runtime.
- `ALFRED_BOOTSTRAP_ADMIN_EMAIL`, `ALFRED_BOOTSTRAP_USER_ID`, and
  `ALFRED_BOOTSTRAP_WORKSPACE_ID`.
- `RUNNER_WORKSPACE_ID`, `RUNNER_DEVICE_ID`, and `RUNNER_DEVICE_TOKEN`.

Use `DATABASE_URL_UNPOOLED` for Drizzle migration jobs, not as the serverless
runtime connection:

```bash
DATABASE_URL="$DATABASE_URL_UNPOOLED" \
  pnpm exec drizzle-kit migrate --config apps/api/drizzle.config.ts
```

If Vercel Deployment Protection is enabled, local smoke checks and the runner
may also need `VERCEL_AUTOMATION_BYPASS_SECRET`. Changing hosted environment
variables requires a new deployment because existing deployments keep their
environment snapshot.

Cloud smoke commands verify API routes rather than a user interface:

```bash
ALFRED_CLOUD_URL=<prod-url> \
pnpm smoke:cloud

ALFRED_CLOUD_URL=<prod-url> \
RUNNER_DEVICE_TOKEN=<device-token> \
RUNNER_WORKSPACE_ID=<workspace-id> \
RUNNER_DEVICE_ID=<device-id> \
pnpm smoke:cloud:runner
```

Public mode checks health and confirms retired browser routes are `404`. Runner
mode sends a heartbeat and synthetic ingest batch.

## Runner

The safe development command uses repository fixtures:

```bash
pnpm runner:local
```

`pnpm runner:local` is the runner used by `pnpm dev:alfred`. It pins
`ALFRED_CODEX_HOME` and `ALFRED_CLAUDE_HOME` to test fixtures and keeps its
SQLite outbox under `apps/runner/.alfred-runner/`.

Each runner pass:

1. reads configured Codex or Claude session files,
2. normalizes recognized records into Alfred ingest events,
3. redacts payloads according to `ALFRED_PRIVACY_MODE`,
4. writes events to the local SQLite outbox,
5. flushes ready events to `POST /v1/ingest/batches`.

Use fixture directories or a temporary `ALFRED_CODEX_HOME` for ordinary
development and validation. Never point the local runner at a real `~/.codex`
or `~/.claude` in those workflows. Read real local agent state only when
intentionally working on ingestion. Non-loopback runner API URLs must use
HTTPS.

## Local runner service

The runner service stays on the Mac because it reads explicitly configured
local agent state. Put its real credentials in `.secrets/runner.env`; never put
them in `.env.example` or committed files. Keep the runner workspace and device
values aligned with the API environment it reports to.

Run the configured service in the foreground:

```bash
pnpm runner:service:run
```

Install and operate the background macOS service:

```bash
pnpm runner:service:install
pnpm runner:service:start
pnpm runner:service:status
pnpm runner:service:doctor
pnpm runner:service:logs
pnpm runner:service:restart
```

Stop or remove it with:

```bash
pnpm runner:service:stop
pnpm runner:service:uninstall
```

`pnpm runner:service:doctor` verifies the launchd process and recent runner boot
evidence. `node scripts/dev-doctor.mjs` checks local processes and service health without creating a browser session or querying runner data from the API.

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

The product-boundary and cloud smoke contracts can be run together without
starting services:

```bash
node --test scripts/test/desktop-product-boundary.test.mjs scripts/test/cloud-smoke.test.mjs
```

## Release gate

Run the complete local release gate:

    pnpm verify

It runs ESLint, typecheck, tests, build, and five Playwright Electron scenarios against a built app. Runtime assertions are the acceptance gate; privacy-safe screenshots, hashes, traces, and CSS captures are diagnostic evidence. The Electron smoke uses temporary HOME, user-data, agent-home, and workspace directories; it does not read the normal Codex or Claude state.

For a faster code-only loop use pnpm verify:quality. To rerun only the desktop smoke use pnpm smoke:electron.

GitHub Actions runs the same quality gate on Linux and the Electron smoke on macOS. The macOS job is visible as a normal failing check, but Phase E does not make it a required branch-protection check.

## Current boundaries

Electron is the only user client. Remote browser access is not part of the first
version, and there is no supported standalone browser client. Vercel serves the
API only. Git history archives the deleted client if its earlier implementation
ever needs to be inspected.
