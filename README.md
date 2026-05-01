# Alfred

Alfred is a personal-cloud agent observatory and command center.

The old macOS/Tauri/Rust prototype is preserved outside this repository as `Alfred_OLD`. This repo is the clean web-first refoundation.

## What Exists Now

- Cloud API skeleton with Hono.
- Postgres data model with Drizzle.
- Shared Zod contracts in `@alfred/schema`.
- Local runner in `@alfred/runner`.
- Shared adapter normalization in `@alfred/adapters`.
- Codex JSONL adapter as the first source adapter.
- SQLite outbox for durable local runner sync.
- Privacy redaction before runner events are persisted or sent.

## Architecture

```text
Agent runtimes
  Codex CLI
  Claude Code later
  OpenAI Agents SDK later
  custom agents later

        |
        v

Local runner
  source adapters
  privacy redaction
  SQLite outbox
  ingest client

        |
        v

Cloud API
  /health
  /v1/ingest/batches

        |
        v

Postgres
  workspaces
  devices
  projects
  runs
  events
  ingest batches
```

## Workspace

```text
apps/
  api/       Hono ingest API
  web/       React/Vite observatory UI
  runner/    local agent runner

packages/
  schema/    shared Zod contracts
  db/        Drizzle schema/client
  adapters/  source normalization helpers

docs/
  local notes only, ignored by git
```

## Local Setup

Run from the repository root:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Copy the local env example when running services:

```bash
cp .env.example .env
```

Start the main local development loop:

```bash
pnpm dev:alfred
```

This starts the API, web app, and runner together. Output is prefixed with
`[api]`, `[web]`, or `[runner]`, and if one process fails the launcher stops
the rest.

## API

Start Postgres:

```bash
docker compose up -d postgres
```

Run migrations:

```bash
pnpm exec drizzle-kit migrate --config apps/api/drizzle.config.ts
```

## Neon / Hosted Postgres Setup

Local development still uses Docker Postgres from `docker compose up -d postgres`.
Keep the local `.env` values from `.env.example` for that path.

For hosted deployments, create a Neon Postgres project outside the repository and
store the real connection strings only in your deployment environment or local
secret manager. Do not commit Neon secrets to this repo.

Use two database URLs:

- `DATABASE_URL`: runtime connection string. In serverless environments, this
  should be the pooled Neon URL, usually the host containing `-pooler`.
- `DATABASE_URL_UNPOOLED`: migration connection string. This should be the
  direct Neon URL without the pooler, used by Drizzle migration commands.

Run hosted migrations with the direct URL:

```bash
DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm exec drizzle-kit migrate --config apps/api/drizzle.config.ts
```

## Vercel Deployment

Required Vercel env vars:

- `DATABASE_URL`: Neon pooled runtime URL.
- `DATABASE_URL_UNPOOLED`: Neon direct migration URL, used only by manual or CI migration jobs.
- `RUNNER_WORKSPACE_ID`
- `RUNNER_DEVICE_ID`
- `RUNNER_DEVICE_TOKEN`
- `APP_BASE_URL`: production Vercel URL.
- `ALFRED_BOOTSTRAP_ADMIN_EMAIL`
- `ALFRED_BOOTSTRAP_USER_ID`
- `ALFRED_BOOTSTRAP_WORKSPACE_ID`

Preview-only optional:

- `ALFRED_ALLOW_DEV_AUTH=1`
- `AUTH_DEV_SESSION_TOKEN`: preview-only token.

Start the API:

```bash
pnpm --filter @alfred/api dev
```

Health check:

```bash
curl -sS http://127.0.0.1:4301/health
```

Query runs:

```bash
curl -sS "http://127.0.0.1:4301/v1/runs?limit=5"
```

The API also accepts the web-style prefix:

```bash
curl -sS "http://127.0.0.1:4301/api/v1/runs?limit=5"
```

## Web

Start the observatory:

```bash
pnpm --filter @alfred/web dev
```

Open:

```text
http://127.0.0.1:4300
```

Port `4300` is the web app. Port `4301` is API only, so open `/health`,
`/v1/runs`, or `/api/v1/runs` there rather than the UI.

The web app proxies `/api/*` to the local API at `http://127.0.0.1:4301`.

## Runner

Development watcher:

```bash
ALFRED_ALLOW_DEV_CONFIG=1 pnpm --filter @alfred/runner dev
```

The development runner polls every 5 seconds by default. Set
`ALFRED_RUNNER_POLL_MS=2000` or another interval when you want a different cadence.

One-shot import:

```bash
ALFRED_ALLOW_DEV_CONFIG=1 pnpm --filter @alfred/runner dev:once
```

Each pass:

1. reads Codex session JSONL files,
2. normalizes recognized records into Alfred ingest events,
3. redacts payloads according to `ALFRED_PRIVACY_MODE`,
4. stores events in the local SQLite outbox,
5. flushes ready events to `POST /v1/ingest/batches`.

## Validation

Current expected checks:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Last known local validation: all pass on `web-observatory`.

## Current Next Step

Use the first web observatory view against live runner data, then add drill-down filters
and richer event inspection.
