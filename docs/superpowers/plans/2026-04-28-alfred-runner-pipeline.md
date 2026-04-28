# Alfred Runner Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local Alfred runner pipeline that collects Claude Code and Codex activity, redacts sensitive payloads, queues events offline, and syncs batches into the cloud ingest API created in MVP0 Tasks 1-5.

**Architecture:** The runner is a local Node/TypeScript process under `refoundation/apps/runner`. It owns a local SQLite outbox for durability, source adapters for Claude and Codex, privacy redaction before persistence/sync, and an ingest client that posts to `/v1/ingest/batches`. Adapter normalization lives in `refoundation/packages/adapters` so future sources can share deterministic event IDs and payload conventions.

**Tech Stack:** TypeScript strict mode, pnpm workspaces, Vitest, better-sqlite3, fast-glob, Hono local hook server, Node `fetch`, `crypto.randomUUID`, shared `@alfred/schema`, cloud API `@alfred/api`.

---

## 0. Current State

Already completed on branch `refoundation-mvp0`:

- `refoundation/` pnpm/Turbo workspace.
- `@alfred/schema` with ingest/report/privacy contracts.
- `@alfred/db` with Postgres schema and migrations.
- `@alfred/api` with `/health`, device bearer auth, and `POST /v1/ingest/batches`.
- Ingest route validates bodies, returns `400 { error: "invalid_body" }` on bad input, and returns `202` on accepted batches.
- Ingest service persists `event_id`, deduplicates batches/events, and updates run timestamps.

Known residual risk:

- No live Postgres migration/ingest verification yet because local Docker daemon was unavailable.
- This phase can be implemented and tested without Docker by testing runner/outbox/client behavior against mocked HTTP and fixture data.

## 1. Scope

This phase builds:

- Runner package skeleton.
- Runner env/config.
- Local SQLite outbox.
- HTTP ingest client.
- Outbox flush worker with retry/backoff.
- Privacy redactor wired before enqueue.
- Shared adapter normalization package.
- Codex CLI adapter, read-only and defensive.
- Claude Code hook server and hook payload normalizer.
- Runner main loop that polls adapters and flushes the outbox.
- Smoke fixture that proves generated batches match `IngestBatchSchema`.

This phase does not build:

- Web UI.
- Query API.
- MCP tools.
- Hosted execution.
- Team/org features.
- Native desktop/mobile wrappers.

## 2. File Structure

Create or modify these files:

```text
refoundation/
  apps/
    runner/
      package.json
      tsconfig.json
      src/
        index.ts
        env.ts
        config.ts
        outbox/outbox-db.ts
        outbox/outbox-worker.ts
        sync/ingest-client.ts
        privacy/redactor.ts
        sources/source-adapter.ts
        sources/codex/codex-sqlite.ts
        sources/codex/codex-jsonl.ts
        sources/codex/codex-adapter.ts
        sources/claude/claude-adapter.ts
        sources/claude/hook-server.ts
        sources/claude/hooks/alfred_claude_hook.py
        test/outbox.test.ts
        test/redactor.test.ts
        test/ingest-client.test.ts
        test/codex-adapter.test.ts
        test/claude-adapter.test.ts
        test/runner-loop.test.ts
        test/fixtures/codex-state.sql
        test/fixtures/codex-session.jsonl
  packages/
    adapters/
      package.json
      tsconfig.json
      src/index.ts
      src/normalize.ts
      test/normalize.test.ts
```

Do not modify existing `app/` or `hooks/` in this phase.

## 3. Runtime Conventions

Runner env:

```bash
RUNNER_API_URL=http://127.0.0.1:4301
RUNNER_DEVICE_TOKEN=dev-device-token
RUNNER_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
RUNNER_DEVICE_ID=00000000-0000-4000-8000-000000000101
ALFRED_PRIVACY_MODE=standard
ALFRED_RUNNER_DB_PATH=.alfred-runner/outbox.sqlite
ALFRED_CODEX_HOME=/Users/patryk/.codex
ALFRED_CLAUDE_HOOK_PORT=4317
```

The runner may use dev defaults only when `NODE_ENV === "test"` or `ALFRED_ALLOW_DEV_CONFIG=1`. In normal runtime, missing `RUNNER_DEVICE_TOKEN`, `RUNNER_WORKSPACE_ID`, or `RUNNER_DEVICE_ID` must fail with a readable config error.

## 4. Task Order

Implement in this order:

1. Runner package and env/config.
2. SQLite outbox.
3. Ingest client and flush worker.
4. Privacy redactor wired into enqueue.
5. Shared adapter normalization.
6. Codex adapter.
7. Claude hook adapter.
8. Runner main loop.
9. Runner smoke validation.

This order keeps data safety first: no source adapter should enqueue data before privacy redaction and offline outbox are in place.

## 5. Tasks

### Task 1: Runner Package and Config

**Files:**

- Create: `refoundation/apps/runner/package.json`
- Create: `refoundation/apps/runner/tsconfig.json`
- Create: `refoundation/apps/runner/src/env.ts`
- Create: `refoundation/apps/runner/src/config.ts`
- Create: `refoundation/apps/runner/src/index.ts`
- Test: `refoundation/apps/runner/src/test/config.test.ts`

- [ ] **Step 1: Add package metadata**

Use this `package.json`:

```json
{
  "name": "@alfred/runner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run src/test",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@alfred/schema": "workspace:*",
    "better-sqlite3": "latest",
    "fast-glob": "latest",
    "hono": "latest",
    "@hono/node-server": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/better-sqlite3": "latest",
    "@types/node": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Add TypeScript config**

Use:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Implement `env.ts`**

`env.ts` must export `parseRunnerEnv(input)` and `runnerEnv`.

Required behavior:

- `RUNNER_API_URL` defaults to `http://127.0.0.1:4301` only in test/dev opt-in.
- `RUNNER_DEVICE_TOKEN`, `RUNNER_WORKSPACE_ID`, and `RUNNER_DEVICE_ID` are required unless `NODE_ENV === "test"` or `ALFRED_ALLOW_DEV_CONFIG=1`.
- `ALFRED_PRIVACY_MODE` defaults to `standard`.
- `ALFRED_RUNNER_DB_PATH` defaults to `.alfred-runner/outbox.sqlite`.
- `ALFRED_CODEX_HOME` defaults to `${HOME}/.codex`.
- `ALFRED_CLAUDE_HOOK_PORT` defaults to `4317`.

Use this shape:

```ts
export type RunnerEnv = {
  RUNNER_API_URL: string;
  RUNNER_DEVICE_TOKEN: string;
  RUNNER_WORKSPACE_ID: string;
  RUNNER_DEVICE_ID: string;
  ALFRED_PRIVACY_MODE: "minimal" | "standard" | "full";
  ALFRED_RUNNER_DB_PATH: string;
  ALFRED_CODEX_HOME: string;
  ALFRED_CLAUDE_HOOK_PORT: number;
};
```

- [ ] **Step 4: Implement `config.ts`**

Export:

```ts
export type RunnerConfig = {
  apiUrl: string;
  deviceToken: string;
  workspaceId: string;
  deviceId: string;
  privacyMode: "minimal" | "standard" | "full";
  outboxPath: string;
  codexHome: string;
  claudeHookPort: number;
};

export function loadRunnerConfig(env = runnerEnv): RunnerConfig {
  return {
    apiUrl: env.RUNNER_API_URL.replace(/\/$/, ""),
    deviceToken: env.RUNNER_DEVICE_TOKEN,
    workspaceId: env.RUNNER_WORKSPACE_ID,
    deviceId: env.RUNNER_DEVICE_ID,
    privacyMode: env.ALFRED_PRIVACY_MODE,
    outboxPath: env.ALFRED_RUNNER_DB_PATH,
    codexHome: env.ALFRED_CODEX_HOME,
    claudeHookPort: env.ALFRED_CLAUDE_HOOK_PORT
  };
}
```

- [ ] **Step 5: Add tests**

Test:

- test env permits dev defaults;
- production env without token throws;
- `loadRunnerConfig` trims trailing slash from API URL;
- privacy mode rejects invalid values.

- [ ] **Step 6: Run commands**

```bash
cd refoundation
pnpm install
pnpm --filter @alfred/runner test
pnpm --filter @alfred/runner typecheck
pnpm build
```

Expected: runner tests pass and workspace builds.

- [ ] **Step 7: Commit**

```bash
git add refoundation/apps/runner refoundation/package.json refoundation/pnpm-lock.yaml
git commit -m "feat(runner): add local runner package"
```

### Task 2: SQLite Outbox

**Files:**

- Create: `refoundation/apps/runner/src/outbox/outbox-db.ts`
- Test: `refoundation/apps/runner/src/test/outbox.test.ts`

- [ ] **Step 1: Implement SQLite schema**

Create table:

```sql
create table if not exists outbox_batches (
  id text primary key,
  payload_json text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at text not null,
  last_error text,
  created_at text not null,
  sent_at text
);
```

Allowed statuses:

```ts
export type OutboxStatus = "pending" | "inflight" | "sent" | "failed";
```

- [ ] **Step 2: Implement API**

Export:

```ts
export type OutboxBatch = {
  id: string;
  payload: IngestBatch;
  status: OutboxStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  lastError?: string;
  createdAt: Date;
  sentAt?: Date;
};

export class OutboxDb {
  constructor(path: string);
  enqueue(batch: IngestBatch): void;
  claimReadyBatch(now: Date): OutboxBatch | null;
  markSent(id: string, now: Date): void;
  markFailed(id: string, error: string, now: Date): void;
  countPending(): number;
  close(): void;
}
```

Behavior:

- `enqueue` is idempotent by `batch.batch_id`.
- `claimReadyBatch` only claims `pending` or `failed` batches whose `next_attempt_at <= now`.
- Claiming sets status to `inflight`.
- `markSent` sets status `sent` and `sent_at`.
- `markFailed` increments attempt count and sets status `failed`.

- [ ] **Step 3: Implement backoff**

Backoff after failure:

```ts
export function nextAttemptDelayMs(attemptCount: number): number {
  if (attemptCount <= 1) return 5_000;
  if (attemptCount === 2) return 30_000;
  if (attemptCount === 3) return 120_000;
  return 600_000;
}
```

- [ ] **Step 4: Test outbox**

Tests must cover:

- enqueue stores parseable JSON;
- duplicate enqueue does not create a second row;
- claim returns due pending batch and marks it inflight;
- future batch is not claimed;
- markSent sets sent timestamp;
- markFailed increments attempts and schedules future retry.

- [ ] **Step 5: Run commands**

```bash
cd refoundation
pnpm --filter @alfred/runner test -- outbox
pnpm --filter @alfred/runner typecheck
```

Expected: outbox tests pass.

- [ ] **Step 6: Commit**

```bash
git add refoundation/apps/runner/src/outbox/outbox-db.ts refoundation/apps/runner/src/test/outbox.test.ts
git commit -m "feat(runner): add durable outbox"
```

### Task 3: Ingest Client and Flush Worker

**Files:**

- Create: `refoundation/apps/runner/src/sync/ingest-client.ts`
- Create: `refoundation/apps/runner/src/outbox/outbox-worker.ts`
- Test: `refoundation/apps/runner/src/test/ingest-client.test.ts`
- Modify: `refoundation/apps/runner/src/test/outbox.test.ts`

- [ ] **Step 1: Implement ingest client**

Export:

```ts
export type SendBatchResult = {
  ok: boolean;
  status: number;
  bodyText: string;
};

export async function sendBatch(params: {
  apiUrl: string;
  deviceToken: string;
  batch: IngestBatch;
  fetchImpl?: typeof fetch;
}): Promise<SendBatchResult> {
  const fetchImpl = params.fetchImpl || fetch;
  const res = await fetchImpl(`${params.apiUrl}/v1/ingest/batches`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.deviceToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params.batch)
  });

  const bodyText = await res.text();
  return {
    ok: res.status === 200 || res.status === 201 || res.status === 202,
    status: res.status,
    bodyText
  };
}
```

- [ ] **Step 2: Test ingest client**

Tests:

- posts to `/v1/ingest/batches`;
- includes bearer token;
- treats 202 as success;
- treats 400/401/500 as failure and preserves status/body.

- [ ] **Step 3: Implement outbox worker**

Export:

```ts
export async function flushOneOutboxBatch(params: {
  outbox: OutboxDb;
  apiUrl: string;
  deviceToken: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<"sent" | "failed" | "idle">;
```

Behavior:

- If no due batch, return `idle`.
- Claim one batch.
- Send it.
- On success, `markSent`.
- On failure or thrown network error, `markFailed`.

- [ ] **Step 4: Test worker**

Tests:

- no batch returns `idle`;
- 202 response marks batch sent;
- 500 response marks batch failed;
- thrown fetch error marks batch failed and stores message.

- [ ] **Step 5: Run commands**

```bash
cd refoundation
pnpm --filter @alfred/runner test -- ingest-client
pnpm --filter @alfred/runner test -- outbox
pnpm --filter @alfred/runner typecheck
pnpm build
```

Expected: runner and workspace build pass.

- [ ] **Step 6: Commit**

```bash
git add refoundation/apps/runner/src/sync/ingest-client.ts refoundation/apps/runner/src/outbox/outbox-worker.ts refoundation/apps/runner/src/test/ingest-client.test.ts refoundation/apps/runner/src/test/outbox.test.ts
git commit -m "feat(runner): sync outbox batches to ingest API"
```

### Task 4: Privacy Redactor

**Files:**

- Create: `refoundation/apps/runner/src/privacy/redactor.ts`
- Test: `refoundation/apps/runner/src/test/redactor.test.ts`
- Modify: `refoundation/apps/runner/src/outbox/outbox-db.ts`
- Modify: `refoundation/apps/runner/src/test/outbox.test.ts`

- [ ] **Step 1: Implement text redaction**

Export:

```ts
export function redactText(input: string): string {
  return input
    .replace(/OPENAI_API_KEY=sk-[A-Za-z0-9_-]{20,}/g, "OPENAI_API_KEY=<redacted>")
    .replace(/ANTHROPIC_API_KEY=[A-Za-z0-9_-]{20,}/g, "ANTHROPIC_API_KEY=<redacted>")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "<redacted:api-key>");
}
```

- [ ] **Step 2: Implement payload redaction**

Export:

```ts
export function redactPayload(
  payload: Record<string, unknown>,
  mode: PrivacyMode
): Record<string, unknown>;
```

Rules:

- Always redact secrets in string values recursively.
- `minimal` removes `transcript`, `command_output`, `diff`, `raw_message`, `raw_json`.
- `standard` removes `transcript`, `diff`, `raw_message`, `raw_json`; keeps `summary`, `files`, `tool_name`, `exit_code`, `test_summary`.
- `full` keeps all fields after secret redaction.

- [ ] **Step 3: Redact before outbox persistence**

Modify `OutboxDb.enqueue(batch, options?)` to redact event payloads before writing JSON.

Use signature:

```ts
enqueue(batch: IngestBatch, options?: { privacyMode?: PrivacyMode }): void;
```

For every event:

```ts
payload: redactPayload(event.payload, event.privacy_mode || options?.privacyMode || "standard")
```

- [ ] **Step 4: Add tests**

Tests:

- `OPENAI_API_KEY=sk-...` becomes `OPENAI_API_KEY=<redacted>`.
- `minimal` removes transcript and keeps summary.
- `standard` removes diff and keeps files.
- `full` keeps diff but redacts secrets inside it.
- `OutboxDb.enqueue` persists redacted payload, not raw secret.

- [ ] **Step 5: Run commands**

```bash
cd refoundation
pnpm --filter @alfred/runner test -- redactor
pnpm --filter @alfred/runner test -- outbox
pnpm --filter @alfred/runner typecheck
```

Expected: redactor and outbox tests pass.

- [ ] **Step 6: Commit**

```bash
git add refoundation/apps/runner/src/privacy/redactor.ts refoundation/apps/runner/src/outbox/outbox-db.ts refoundation/apps/runner/src/test/redactor.test.ts refoundation/apps/runner/src/test/outbox.test.ts
git commit -m "feat(runner): redact payloads before outbox persistence"
```

### Task 5: Adapter Normalization Package

**Files:**

- Create: `refoundation/packages/adapters/package.json`
- Create: `refoundation/packages/adapters/tsconfig.json`
- Create: `refoundation/packages/adapters/src/normalize.ts`
- Create: `refoundation/packages/adapters/src/index.ts`
- Test: `refoundation/packages/adapters/test/normalize.test.ts`
- Modify: `refoundation/apps/runner/package.json`
- Modify: `refoundation/pnpm-lock.yaml`

- [ ] **Step 1: Add package metadata**

Use:

```json
{
  "name": "@alfred/adapters",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@alfred/schema": "workspace:*",
    "zod": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Define normalize input**

In `normalize.ts`:

```ts
export type NormalizedEventInput = {
  workspaceId: string;
  deviceId: string;
  projectKey: string;
  sourceId: AgentSource;
  sourceRunId: string;
  sourceEventId: string;
  parentSourceRunId?: string;
  type: EventType;
  status?: RunStatus;
  privacyMode?: PrivacyMode;
  occurredAt: string;
  payload?: Record<string, unknown>;
};
```

- [ ] **Step 3: Implement deterministic IDs**

Use Node crypto hash:

```ts
import { createHash } from "node:crypto";

export function makeEventId(input: {
  sourceId: AgentSource;
  sourceRunId: string;
  sourceEventId: string;
  type: EventType;
  occurredAt: string;
}): string {
  const raw = [
    input.sourceId,
    input.sourceRunId,
    input.sourceEventId,
    input.type,
    input.occurredAt
  ].join("|");
  return `evt_${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}
```

- [ ] **Step 4: Implement event helper**

```ts
export function normalizeEvent(input: NormalizedEventInput): IngestEvent {
  return IngestEventSchema.parse({
    event_id: makeEventId(input),
    workspace_id: input.workspaceId,
    device_id: input.deviceId,
    project_key: input.projectKey,
    source_id: input.sourceId,
    source_run_id: input.sourceRunId,
    source_event_id: input.sourceEventId,
    parent_source_run_id: input.parentSourceRunId,
    type: input.type,
    status: input.status,
    privacy_mode: input.privacyMode || "standard",
    occurred_at: input.occurredAt,
    payload: input.payload || {}
  });
}
```

- [ ] **Step 5: Add convenience helpers**

Export:

- `makeRunStartedEvent(input)`
- `makeRunUpdatedEvent(input)`
- `makeRunCompletedEvent(input)`
- `makeSpawnCreatedEvent(input)`

Each wraps `normalizeEvent` with the correct `type`.

- [ ] **Step 6: Add tests**

Tests:

- same input gives same `event_id`;
- changing `source_event_id` changes `event_id`;
- helper output passes `IngestEventSchema`;
- `makeSpawnCreatedEvent` preserves `parent_source_run_id`;
- default privacy is `standard`.

- [ ] **Step 7: Add dependency to runner**

Add to `refoundation/apps/runner/package.json`:

```json
"@alfred/adapters": "workspace:*"
```

- [ ] **Step 8: Run commands**

```bash
cd refoundation
pnpm install
pnpm --filter @alfred/adapters test
pnpm --filter @alfred/adapters typecheck
pnpm build
pnpm test
pnpm typecheck
```

Expected: all workspace packages pass.

- [ ] **Step 9: Commit**

```bash
git add refoundation/packages/adapters refoundation/apps/runner/package.json refoundation/package.json refoundation/pnpm-lock.yaml
git commit -m "feat(adapters): add source normalization contract"
```

### Task 6: Source Adapter Interface

**Files:**

- Create: `refoundation/apps/runner/src/sources/source-adapter.ts`
- Test: `refoundation/apps/runner/src/test/source-adapter.test.ts`

- [ ] **Step 1: Define adapter types**

Use:

```ts
export type SourceCursor = {
  source_id: AgentSource;
  cursor_key: string;
  cursor_value: string;
};

export type SourceHealth = {
  ok: boolean;
  message: string;
  checked_at: string;
  warnings?: string[];
};

export type SourceRunPage = {
  events: IngestEvent[];
  nextCursor?: SourceCursor;
};

export interface SourceAdapter {
  sourceId: AgentSource;
  displayName: string;
  discover(cursor?: SourceCursor): Promise<SourceRunPage>;
  healthCheck(): Promise<SourceHealth>;
}
```

Use `discover()` returning normalized events, not raw runs, so the main loop can enqueue batches without knowing source internals.

- [ ] **Step 2: Add helper**

Export:

```ts
export function okHealth(message: string): SourceHealth {
  return { ok: true, message, checked_at: new Date().toISOString() };
}
```

and:

```ts
export function failedHealth(error: unknown): SourceHealth {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    checked_at: new Date().toISOString()
  };
}
```

- [ ] **Step 3: Add tests**

Tests:

- `okHealth` returns `ok: true`;
- `failedHealth(new Error("bad"))` returns message `bad`;
- type-only compile of a fake adapter implementing `discover`.

- [ ] **Step 4: Run commands**

```bash
cd refoundation
pnpm --filter @alfred/runner test -- source-adapter
pnpm --filter @alfred/runner typecheck
```

- [ ] **Step 5: Commit**

```bash
git add refoundation/apps/runner/src/sources/source-adapter.ts refoundation/apps/runner/src/test/source-adapter.test.ts
git commit -m "feat(runner): define source adapter interface"
```

### Task 7: Codex CLI Adapter

**Files:**

- Create: `refoundation/apps/runner/src/sources/codex/codex-sqlite.ts`
- Create: `refoundation/apps/runner/src/sources/codex/codex-jsonl.ts`
- Create: `refoundation/apps/runner/src/sources/codex/codex-adapter.ts`
- Create: `refoundation/apps/runner/src/test/fixtures/codex-state.sql`
- Create: `refoundation/apps/runner/src/test/fixtures/codex-session.jsonl`
- Test: `refoundation/apps/runner/src/test/codex-adapter.test.ts`

- [ ] **Step 1: Implement SQLite introspection**

In `codex-sqlite.ts`:

```ts
export function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(tableName);
  return Boolean(row);
}

export function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}
```

Do not query a Codex table before `hasTable`.

- [ ] **Step 2: Implement thread reader**

Export:

```ts
export type CodexThread = {
  id: string;
  rolloutPath?: string;
  createdAt?: string;
  updatedAt?: string;
  cwd?: string;
  title?: string;
  modelProvider?: string;
  model?: string;
  reasoningEffort?: string;
  tokensUsed?: number;
  archived?: boolean;
  gitBranch?: string;
  gitSha?: string;
  cliVersion?: string;
};
```

Read only columns that exist:

- `id`
- `rollout_path`
- `created_at`
- `updated_at`
- `cwd`
- `title`
- `model_provider`
- `model`
- `reasoning_effort`
- `tokens_used`
- `archived`
- `git_branch`
- `git_sha`
- `cli_version`

- [ ] **Step 3: Implement spawn edge reader**

If `thread_spawn_edges` exists, read:

- `parent_thread_id`
- `child_thread_id`
- `status`

Return empty array when table is absent.

- [ ] **Step 4: Implement JSONL parser**

In `codex-jsonl.ts`:

```ts
export type JsonlParseResult = {
  objects: Array<Record<string, unknown>>;
  malformedLines: number;
};
```

Behavior:

- split file by newline;
- skip empty lines;
- parse each line independently;
- increment `malformedLines` for bad JSON;
- never throw for a malformed line.

- [ ] **Step 5: Implement adapter**

`createCodexAdapter(config)` should:

- read `${codexHome}/state_5.sqlite` if present;
- read `${codexHome}/sessions/**/*.jsonl` if present;
- return health `ok: true` with warnings if files are missing;
- normalize threads into `run.updated` events;
- normalize spawn edges into `spawn.created` events;
- not include raw message text unless privacy mode is `full`.

Thread payload in standard mode:

```ts
{
  title,
  cwd,
  model,
  reasoning_effort,
  tokens_used,
  git_branch,
  git_sha,
  cli_version
}
```

- [ ] **Step 6: Add fixtures**

`codex-state.sql` must create:

- `threads` table with one parent and one child thread;
- `thread_spawn_edges` table with parent-child edge.

`codex-session.jsonl` must contain:

- one valid JSON object line;
- one malformed JSON line;
- one empty line.

- [ ] **Step 7: Add tests**

Tests:

- missing Codex home returns health warning and zero events;
- fixture threads become `run.updated` events;
- fixture spawn edge becomes `spawn.created`;
- malformed JSONL increments warning count but does not fail;
- adapter never emits raw message content in `standard` mode.

- [ ] **Step 8: Run commands**

```bash
cd refoundation
pnpm --filter @alfred/runner test -- codex-adapter
pnpm --filter @alfred/runner typecheck
pnpm build
```

- [ ] **Step 9: Commit**

```bash
git add refoundation/apps/runner/src/sources/codex refoundation/apps/runner/src/test/fixtures refoundation/apps/runner/src/test/codex-adapter.test.ts
git commit -m "feat(runner): collect Codex CLI sessions"
```

### Task 8: Claude Hook Adapter

**Files:**

- Create: `refoundation/apps/runner/src/sources/claude/claude-adapter.ts`
- Create: `refoundation/apps/runner/src/sources/claude/hook-server.ts`
- Create: `refoundation/apps/runner/src/sources/claude/hooks/alfred_claude_hook.py`
- Test: `refoundation/apps/runner/src/test/claude-adapter.test.ts`

- [ ] **Step 1: Define Claude hook input**

In `claude-adapter.ts`:

```ts
export type ClaudeHookPayload = {
  hook_event: "SessionStart" | "PreToolUse" | "PostToolUse" | "Notification" | "Stop" | "SessionEnd";
  session_id: string;
  cwd?: string;
  tool_name?: string;
  summary?: string;
  message?: string;
  success?: boolean;
  occurred_at?: string;
};
```

- [ ] **Step 2: Implement normalizer**

Export:

```ts
export function normalizeClaudeHook(
  payload: ClaudeHookPayload,
  config: {
    workspaceId: string;
    deviceId: string;
    privacyMode: PrivacyMode;
  }
): IngestEvent;
```

Mapping:

- `SessionStart` -> `run.started`, status `running`;
- `PreToolUse` -> `tool.started`;
- `PostToolUse` -> `tool.completed` when `success !== false`, otherwise `tool.failed`;
- `Notification` -> `agent.waiting`, status `waiting`;
- `Stop` -> `run.completed`, status `completed`;
- `SessionEnd` -> `run.completed`, status `completed`.

Use `payload.cwd || "unknown"` as `project_key`.

- [ ] **Step 3: Implement hook server**

In `hook-server.ts`, export:

```ts
export function createClaudeHookServer(params: {
  workspaceId: string;
  deviceId: string;
  privacyMode: PrivacyMode;
  onEvent: (event: IngestEvent) => Promise<void> | void;
}): Hono;
```

Route:

```text
POST /sources/claude/events
```

Behavior:

- parse JSON body;
- normalize hook;
- call `onEvent`;
- return `{ ok: true }`;
- malformed payload returns `400 { error: "invalid_claude_hook" }`.

- [ ] **Step 4: Add Python hook script**

Use:

```python
import json
import os
import sys
import urllib.request

payload = json.load(sys.stdin)
url = os.environ.get("ALFRED_RUNNER_HOOK_URL", "http://127.0.0.1:4317/sources/claude/events")
data = json.dumps(payload).encode("utf-8")
req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")

try:
    urllib.request.urlopen(req, timeout=1.5).read()
except Exception:
    pass
```

- [ ] **Step 5: Add tests**

Tests:

- Notification maps to `agent.waiting`;
- Stop maps to `run.completed` with `completed` status;
- PostToolUse success false maps to `tool.failed`;
- hook server returns `400` for bad payload;
- hook server calls `onEvent` for valid payload.

- [ ] **Step 6: Run commands**

```bash
cd refoundation
pnpm --filter @alfred/runner test -- claude-adapter
pnpm --filter @alfred/runner typecheck
```

- [ ] **Step 7: Commit**

```bash
git add refoundation/apps/runner/src/sources/claude refoundation/apps/runner/src/test/claude-adapter.test.ts
git commit -m "feat(runner): collect Claude Code hook events"
```

### Task 9: Runner Main Loop

**Files:**

- Modify: `refoundation/apps/runner/src/index.ts`
- Create: `refoundation/apps/runner/src/test/runner-loop.test.ts`

- [ ] **Step 1: Implement batch builder**

Export from `index.ts` or a small helper inside it:

```ts
export function createBatch(params: {
  workspaceId: string;
  deviceId: string;
  events: IngestEvent[];
  now: Date;
}): IngestBatch {
  return IngestBatchSchema.parse({
    batch_id: crypto.randomUUID(),
    workspace_id: params.workspaceId,
    device_id: params.deviceId,
    sent_at: params.now.toISOString(),
    events: params.events
  });
}
```

- [ ] **Step 2: Implement source polling**

Export:

```ts
export async function pollSourceOnce(params: {
  adapter: SourceAdapter;
  outbox: OutboxDb;
  workspaceId: string;
  deviceId: string;
  now: Date;
}): Promise<{ enqueued: number; health: SourceHealth }>;
```

Behavior:

- call `adapter.discover()`;
- if zero events, enqueue nothing;
- if events exist, create one batch and enqueue;
- catch adapter errors and return failed health instead of throwing.

- [ ] **Step 3: Implement runner start**

`main()` should:

1. Load config.
2. Open outbox.
3. Create Codex adapter.
4. Start Claude hook server on configured port.
5. On Claude hook event, enqueue a batch immediately.
6. Poll Codex every 10 seconds.
7. Flush one outbox batch every 5 seconds.
8. Log health every 60 seconds.

No process should start when `index.ts` is imported in tests. Use:

```ts
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Add tests**

Tests:

- `createBatch` output passes `IngestBatchSchema`;
- `pollSourceOnce` enqueues one batch when adapter returns events;
- `pollSourceOnce` does not throw when adapter throws;
- empty event page enqueues nothing.

- [ ] **Step 5: Run commands**

```bash
cd refoundation
pnpm --filter @alfred/runner test -- runner-loop
pnpm --filter @alfred/runner test
pnpm --filter @alfred/runner typecheck
pnpm build
pnpm test
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add refoundation/apps/runner/src/index.ts refoundation/apps/runner/src/test/runner-loop.test.ts
git commit -m "feat(runner): orchestrate local source sync"
```

### Task 10: Runner Smoke Validation

**Files:**

- Create: `refoundation/apps/runner/src/test/runner-smoke.test.ts`
- Modify: `refoundation/README.md`

- [ ] **Step 1: Add smoke test**

Test should:

- create temp outbox;
- create fake adapter returning one Codex event and one Claude event;
- poll both adapters;
- claim two outbox batches;
- validate both payloads with `IngestBatchSchema`;
- assert payloads contain `source_id` values `codex-cli` and `claude-code`;
- assert no payload contains `OPENAI_API_KEY=`.

- [ ] **Step 2: Add README runner commands**

Add:

```bash
cd refoundation
pnpm --filter @alfred/runner dev
```

Add env example:

```bash
ALFRED_ALLOW_DEV_CONFIG=1 pnpm --filter @alfred/runner dev
```

Add note:

```text
The runner uses a local SQLite outbox only for durable delivery. Postgres remains the canonical cloud database.
```

- [ ] **Step 3: Run commands**

```bash
cd refoundation
pnpm --filter @alfred/runner test
pnpm test
pnpm typecheck
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add refoundation/apps/runner/src/test/runner-smoke.test.ts refoundation/README.md
git commit -m "test(runner): validate local source to outbox smoke flow"
```

## 6. Verification Matrix

Run before calling this phase complete:

```bash
cd refoundation
pnpm install
pnpm --filter @alfred/runner test
pnpm --filter @alfred/adapters test
pnpm test
pnpm typecheck
pnpm build
```

Expected:

- schema tests pass;
- db typecheck/build pass;
- api tests pass;
- runner tests pass;
- adapters tests pass;
- no TypeScript errors.

Manual check after Docker is available:

```bash
cd refoundation
docker compose up -d postgres
pnpm exec drizzle-kit migrate --config apps/api/drizzle.config.ts
ALFRED_ALLOW_DEV_TOKEN=1 pnpm --filter @alfred/api dev
ALFRED_ALLOW_DEV_CONFIG=1 pnpm --filter @alfred/runner dev
```

Then trigger a Claude hook or run a Codex fixture poll and confirm API returns `202` for batches.

## 7. Acceptance Criteria

Phase 2 is complete when:

- Runner package exists and builds.
- Runner refuses unsafe missing token/config outside test or explicit dev opt-in.
- Outbox stores batches durably in SQLite.
- Outbox retries failed syncs with expected backoff.
- Payloads are redacted before outbox persistence.
- Adapter package emits deterministic event IDs.
- Codex adapter reads fixture SQLite/JSONL defensively and emits normalized events.
- Claude hook adapter accepts local hook payloads and emits normalized events.
- Main loop can poll sources and enqueue batches without crashing on adapter failure.
- Full workspace `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.

## 8. Follow-Up Phase

After this plan, implement the next phase:

1. Query API for runs, events, missions, reports.
2. MCP tools for missions and field reports.
3. Web Live view backed by real API data.
4. PWA/mobile responsive pass.

Do not start those until runner events can be generated and synced.
