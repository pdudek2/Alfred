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

## API

Start Postgres:

```bash
docker compose up -d postgres
```

Run migrations:

```bash
pnpm exec drizzle-kit migrate --config apps/api/drizzle.config.ts
```

Start the API:

```bash
pnpm --filter @alfred/api dev
```

Health check:

```bash
curl -sS http://127.0.0.1:4301/health
```

## Runner

Development one-shot run:

```bash
ALFRED_ALLOW_DEV_CONFIG=1 pnpm --filter @alfred/runner dev
```

The runner currently performs one pass:

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

Last known local validation: all pass after PR `#1`, squash commit `8fb04bc`.

## Current Next Step

Confirm live ingest end to end:

1. start Postgres,
2. migrate the database,
3. start `@alfred/api`,
4. run `@alfred/runner`,
5. verify persisted runs/events in Postgres.

After that, the next product slice is query API + first web observatory view.
