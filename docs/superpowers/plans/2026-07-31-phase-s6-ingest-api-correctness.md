# Phase S6 — Ingest/API Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dependency resolution deterministic, exercise the production ingest store against PostgreSQL-compatible behavior, preserve parent-run lifecycle, and make hosted API startup reject missing or invalid database configuration.

**Architecture:** Export the existing Drizzle ingest-store seam and run it against an isolated in-memory PGlite database initialized from the canonical migrations. Keep route tests on a minimal orchestration fake, neutralize synthetic parent events at their creation point, and pass the validated `DATABASE_URL` explicitly into the existing database pool.

**Tech Stack:** TypeScript, Drizzle ORM 0.45.x, PGlite, PostgreSQL migrations, Zod, Hono, Vitest, pnpm.

## Global Constraints

- Implement only findings 12, 20, and 21 from the post-v1 stabilization roadmap.
- The accepted contract is `docs/superpowers/specs/2026-07-31-phase-s6-ingest-api-correctness-design.md`.
- PGlite is an `@alfred/api` development dependency only; production remains on `pg`.
- Use the canonical `drizzle/` migrations. Do not create a test-only schema or migration.
- Keep the local `DATABASE_URL` fallback; require a valid `postgres:` or `postgresql:` URL in hosted runtime.
- Do not add a repository layer, factory hierarchy, database readiness probe, Docker dependency, compatibility path, or production migration.
- Do not modify desktop UI, browser auth, runner device-token auth, retired query routes, or broad global styles.
- Freeze every existing `latest` declaration to the exact version selected in
  commit `b369e60`; do not intentionally upgrade or downgrade any existing
  package.
- Preserve the two floating Babel edges exposed by pnpm regeneration with
  parent-scoped overrides only:
  `@testing-library/dom@10.4.1 > @babel/code-frame@7.29.0` and
  `@babel/code-frame@7.29.0 > @babel/helper-validator-identifier@7.28.5`.
- Regenerate `pnpm-lock.yaml` with pnpm only. Do not hand-edit it.
- After the freeze, PGlite must be the only new package introduced by S6.
- Never run the real runner against `~/.codex`; S6 needs no runner process.
- Never force-push or add AI co-author trailers.
- Do not push without Patryk's explicit authorization for the implementation session.

## File Map

- Workspace `package.json` files containing `latest` — pin only their existing
  resolved versions.
- `pnpm-workspace.yaml` — add two narrow parent-scoped Babel resolution pins.
- `apps/api/package.json` — declare PGlite as a test-only dependency.
- `pnpm-lock.yaml` — pnpm-generated specifier freeze plus the PGlite graph.
- `apps/api/src/services/ingest-service.ts` — expose the production store to both PostgreSQL drivers and neutralize parent synthesis.
- `apps/api/src/test/support/ingest-fixtures.ts` — shared valid ingest batch builder and stable fixture IDs.
- `apps/api/src/test/support/pglite-ingest-db.ts` — create, migrate, and close one isolated PGlite database.
- `apps/api/src/test/ingest-store.test.ts` — production-store persistence, lifecycle, duplicate, ordering, and parent regressions.
- `apps/api/src/test/ingest.test.ts` — retain HTTP/auth/heartbeat tests on a minimal orchestration fake.
- `apps/api/src/env.ts` — validate hosted `DATABASE_URL`.
- `apps/api/src/test/env.test.ts` — local and hosted database environment regressions.
- `apps/api/src/app.ts` — pass the parsed URL explicitly to `createPool`.
- `apps/api/src/test/app.test.ts` — prove application database construction uses the parsed URL.
- `docs/superpowers/specs/2026-07-31-phase-s6-ingest-api-correctness-design.md` — final S6 status and evidence.
- `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md` — close S6 and route next to S7.

---

### Task 0: Freeze the existing dependency graph

**Files:**
- Modify: workspace `package.json` files containing `latest`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: dependency versions selected by `pnpm-lock.yaml` at commit
  `b369e60`.
- Produces: exact manifest specifiers for the same dependency graph and a
  reproducible pnpm lockfile.

- [ ] **Step 1: Record the current moving declarations**

Run:

```bash
test "$(rg -n '"latest"' --glob package.json . | wc -l | tr -d ' ')" = "52"
```

Expected: exactly 52 declarations require freezing.

- [ ] **Step 2: Pin each declaration to its accepted locked version**

For every `latest` dependency, read the corresponding resolved version from
the `b369e60` lockfile importer and replace only that manifest value. Use
`apply_patch` for manifest edits.

Expected: `rg -n '"latest"' --glob package.json .` returns no matches, every
replacement is an exact version, and no dependency name is added or removed.

- [ ] **Step 3: Regenerate the lockfile with pnpm**

Add only these root overrides to `pnpm-workspace.yaml`:

```yaml
overrides:
  '@testing-library/dom@10.4.1>@babel/code-frame': 7.29.0
  '@babel/code-frame@7.29.0>@babel/helper-validator-identifier': 7.28.5
```

They preserve the exact pre-S6 transitive edges without changing other Babel
consumers. Restore the S6 worktree's generated lockfile to its `b369e60`
content, then run:

```bash
pnpm install --lockfile-only
```

Expected: pnpm records exact manifest specifiers while preserving the
pre-S6 resolved versions. Pnpm may refresh non-resolution metadata such as a
deprecation message; it must not change an existing package version. Do not
hand-edit the lockfile.

- [ ] **Step 4: Prove the freeze did not change package versions**

Compare every pre-existing package resolution against `b369e60`.

Expected: no pre-existing package version changed; the only additional
package graph belongs to API-dev-only PGlite from Task 1.

- [ ] **Step 5: Verify and commit the prerequisite**

Run:

```bash
pnpm verify
git diff --check
git add -- ':(glob)**/package.json' pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: freeze dependency versions"
```

Expected: the full repository gate passes and the commit contains only exact
specifier pins plus the pnpm-generated lockfile.

---

### Task 1: Put the production ingest store behind a PGlite contract

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/services/ingest-service.ts:1-18,38-41,163-170,237-250`
- Modify: `apps/api/src/test/ingest.test.ts:1-41`
- Create: `apps/api/src/test/support/ingest-fixtures.ts`
- Create: `apps/api/src/test/support/pglite-ingest-db.ts`
- Create: `apps/api/src/test/ingest-store.test.ts`

**Interfaces:**
- Consumes: canonical exports from `@alfred/db`, root `drizzle/` migrations, `ingestBatch`, and Drizzle's common `PgDatabase` base.
- Produces: exported `createDrizzleIngestStore<TQueryResult, TFullSchema, TSchema>(db): IngestStore`, `makeBatch`, stable fixture IDs, and `createPgliteIngestDatabase()`.

- [ ] **Step 1: Confirm the one accepted test dependency**

Run:

```bash
pnpm --filter @alfred/api why @electric-sql/pglite
```

Expected: `@electric-sql/pglite` appears only in
`apps/api/package.json#devDependencies`; `pnpm-lock.yaml` contains its generated
resolution and Drizzle peer edge. No unrelated package resolution changed.

- [ ] **Step 2: Extract the shared valid batch fixture**

Create `apps/api/src/test/support/ingest-fixtures.ts`:

```ts
import { IngestBatchSchema, type IngestBatch } from "@alfred/schema";

export const workspaceId = "00000000-0000-4000-8000-000000000001";
export const deviceId = "00000000-0000-4000-8000-000000000101";

type BatchEventOverrides = Partial<IngestBatch["events"][number]>;

export function makeBatch(
  batchId = "00000000-0000-4000-8000-000000000201",
  eventOverrides: BatchEventOverrides = {},
): IngestBatch {
  return IngestBatchSchema.parse({
    batch_id: batchId,
    workspace_id: workspaceId,
    device_id: deviceId,
    sent_at: "2026-01-01T10:00:00.000Z",
    events: [
      {
        event_id: "event-000000000001",
        workspace_id: workspaceId,
        device_id: deviceId,
        project_key: "alfred",
        source_id: "codex-cli",
        source_run_id: "run-1",
        source_event_id: "source-event-1",
        type: "run.started",
        status: "running",
        privacy_mode: "standard",
        occurred_at: "2026-01-01T10:00:00.000Z",
        payload: { cwd: "/Users/patryk/Desktop/Alfred" },
        ...eventOverrides,
      },
    ],
  });
}
```

Replace the local constants and `makeBatch` definition at the top of
`ingest.test.ts` with:

```ts
import { deviceId, makeBatch, workspaceId } from "./support/ingest-fixtures";
```

Run:

```bash
pnpm --filter @alfred/api exec vitest run src/test/ingest.test.ts
```

Expected: the existing ingest tests still pass before persistence behavior is
moved.

- [ ] **Step 3: Create the isolated PGlite migration helper**

Create `apps/api/src/test/support/pglite-ingest-db.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import {
  devices,
  events,
  ingestBatches,
  projects,
  runRelations,
  runs,
  users,
  workspaces,
} from "@alfred/db";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";

const ingestSchema = {
  devices,
  events,
  ingestBatches,
  projects,
  runRelations,
  runs,
  users,
  workspaces,
};

const migrationsFolder = fileURLToPath(
  new URL("../../../../../drizzle", import.meta.url),
);

export async function createPgliteIngestDatabase() {
  const client = new PGlite();
  const db = drizzle({ client, schema: ingestSchema });
  await migrate(db, { migrationsFolder });

  return {
    client,
    db,
    close: () => client.close(),
  };
}
```

Do not reproduce DDL in this helper. A migration incompatibility must fail the
test rather than silently switching to a reduced schema.

- [ ] **Step 4: Write a failing persisted-batch contract test**

Create `apps/api/src/test/ingest-store.test.ts`:

```ts
import { events, ingestBatches, projects, runs } from "@alfred/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleIngestStore,
  ingestBatch,
} from "../services/ingest-service";
import { makeBatch } from "./support/ingest-fixtures";
import {
  createPgliteIngestDatabase,
} from "./support/pglite-ingest-db";

type Fixture = Awaited<ReturnType<typeof createPgliteIngestDatabase>>;

describe("production ingest store", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createPgliteIngestDatabase();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("persists a new batch through the production Drizzle store", async () => {
    const result = await ingestBatch(
      createDrizzleIngestStore(fixture.db),
      makeBatch(),
    );

    expect(result).toEqual({
      batch_id: "00000000-0000-4000-8000-000000000201",
      accepted_events: 1,
      duplicate_events: 0,
      duplicate_batch: false,
    });
    await expect(fixture.db.select().from(ingestBatches)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(projects)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(runs)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(events)).resolves.toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run the contract test and verify the seam is inaccessible**

Run:

```bash
pnpm --filter @alfred/api exec vitest run src/test/ingest-store.test.ts
```

Expected: FAIL because `createDrizzleIngestStore` is not exported and its
current node-postgres-specific type does not accept the PGlite driver.

- [ ] **Step 6: Make the existing store seam driver-neutral and exported**

In `ingest-service.ts`, import the shared PostgreSQL database types:

```ts
import type {
  PgDatabase,
  PgQueryResultHKT,
} from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";
```

Delete `DrizzleIngestDb`. Replace the private store function with:

```ts
export function createDrizzleIngestStore<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown>,
  TSchema extends TablesRelationalConfig,
>(
  db: PgDatabase<TQueryResult, TFullSchema, TSchema>,
): IngestStore {
  return {
    transaction: async (fn) =>
      db.transaction((tx) => fn(createDrizzleIngestStore(tx))),
```

Keep the existing methods below this header. In `ensureDevice`, remove the
optional-select branch and always perform the ownership query:

```ts
      const [existingDevice] = await db
        .select({ workspaceId: devices.workspaceId })
        .from(devices)
        .where(eq(devices.id, batch.device_id))
        .limit(1);

      if (existingDevice && existingDevice.workspaceId !== batch.workspace_id) {
        throw new Error("Device belongs to another workspace");
      }
```

Do not add a PGlite-specific branch or cast. Both node-postgres and PGlite
derive from Drizzle's `PgDatabase`.

- [ ] **Step 7: Run the production-store test and API typecheck**

Run:

```bash
pnpm --filter @alfred/api exec vitest run src/test/ingest-store.test.ts
pnpm --filter @alfred/api typecheck
```

Expected: the canonical migrations apply, one batch persists all four asserted
records, the PGlite instance closes, and TypeScript accepts both Drizzle
drivers.

- [ ] **Step 8: Commit the production-store contract**

```bash
git add apps/api/package.json pnpm-lock.yaml \
  apps/api/src/services/ingest-service.ts \
  apps/api/src/test/ingest.test.ts \
  apps/api/src/test/ingest-store.test.ts \
  apps/api/src/test/support/ingest-fixtures.ts \
  apps/api/src/test/support/pglite-ingest-db.ts
git commit -m "test: exercise production ingest store"
```

---

### Task 2: Move lifecycle and conflict guarantees off the fake

**Files:**
- Modify: `apps/api/src/test/ingest-store.test.ts`
- Modify: `apps/api/src/test/ingest.test.ts:43-180,195-367,553-577`

**Interfaces:**
- Consumes: `createPgliteIngestDatabase`, `createDrizzleIngestStore`, shared `makeBatch`, and canonical `runs`.
- Produces: production-backed lifecycle and duplicate regressions; `makeRouteStore()` limited to HTTP/auth/heartbeat observations.

- [ ] **Step 1: Add a persisted-run reader to the store test**

Import `and`, `eq`, and the stable workspace ID:

```ts
import { and, eq } from "drizzle-orm";
import { makeBatch, workspaceId } from "./support/ingest-fixtures";
```

Inside the describe block add:

```ts
  async function readRun(sourceRunId = "run-1") {
    const [run] = await fixture.db
      .select({
        id: runs.id,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
      })
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, workspaceId),
          eq(runs.sourceId, "codex-cli"),
          eq(runs.sourceRunId, sourceRunId),
        ),
      );
    return run;
  }

  function store() {
    return createDrizzleIngestStore(fixture.db);
  }
```

Use `store()` in the baseline test as well.

- [ ] **Step 2: Move the existing lifecycle and duplicate cases**

Move these exact tests from `ingest.test.ts` into
`ingest-store.test.ts`, preserving their event IDs, batch IDs, event types,
statuses, and timestamps:

- `accepts the same batch twice without duplicating events`;
- `updates an existing run with completion status and timestamp`;
- `reopens an existing run when more activity arrives after a completed turn`;
- `does not reopen a terminal run from an older waiting event`;
- `closes an existing run when a run update marks it cancelled`;
- `counts duplicate events across different batches`;
- `keeps an existing run status when a technical event has no status`.

Replace each `makeInMemoryStore()` with `store()`. Replace each `getRun(...)`
assertion with `await readRun()`. For example, the completion assertion becomes:

```ts
    expect(await readRun()).toMatchObject({
      status: "completed",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      completedAt: new Date("2026-01-01T10:05:00.000Z"),
    });
```

Keep result assertions for duplicate batches and duplicate events unchanged;
the production store is now responsible for producing those counts.

- [ ] **Step 3: Replace the copied lifecycle fake with a route-only fake**

Delete `InMemoryRun`, `runStatusForTest`, `runTimestampsForTest`,
`isTerminalRunEventForTest`, the run/event/project maps, and `getRun` from
`ingest.test.ts`.

Retain the heartbeat observation types and replace `makeInMemoryStore` with:

```ts
function makeRouteStore(): IngestStore & {
  getEnsuredDevice: () => InMemoryEnsuredDevice | undefined;
  getEnsuredWorkspace: () => string | undefined;
  getDeviceSeen: () => InMemoryDeviceSeen | undefined;
} {
  let ensuredWorkspace: string | undefined;
  let ensuredDevice: InMemoryEnsuredDevice | undefined;
  let deviceSeen: InMemoryDeviceSeen | undefined;

  const store: IngestStore & {
    getEnsuredDevice: () => InMemoryEnsuredDevice | undefined;
    getEnsuredWorkspace: () => string | undefined;
    getDeviceSeen: () => InMemoryDeviceSeen | undefined;
  } = {
    transaction: async (fn) => fn(store),
    insertBatchIfNew: async () => true,
    markBatchAccepted: async () => undefined,
    ensureWorkspace: async (seenWorkspaceId) => {
      ensuredWorkspace = seenWorkspaceId;
    },
    ensureDevice: async (device) => {
      ensuredDevice = {
        workspaceId: device.workspace_id,
        deviceId: device.device_id,
        sentAt: device.sent_at,
      };
    },
    markDeviceSeen: async (seenWorkspaceId, seenDeviceId, seenAt) => {
      deviceSeen = {
        workspaceId: seenWorkspaceId,
        deviceId: seenDeviceId,
        seenAt,
      };
    },
    upsertProject: async () => ({ id: "fixture-project" }),
    upsertRun: async () => ({ id: "fixture-run" }),
    upsertRelation: async () => undefined,
    insertEvent: async () => true,
    getEnsuredDevice: () => ensuredDevice,
    getEnsuredWorkspace: () => ensuredWorkspace,
    getDeviceSeen: () => deviceSeen,
  };

  return store;
}
```

Replace remaining route and heartbeat uses of `makeInMemoryStore()` with
`makeRouteStore()`. The route fake must contain no status, timestamp,
ordering, transaction-conflict, or duplicate implementation.

- [ ] **Step 4: Run both ingest suites**

Run:

```bash
pnpm --filter @alfred/api exec vitest run \
  src/test/ingest-store.test.ts \
  src/test/ingest.test.ts
```

Expected: all lifecycle and duplicate cases pass through PGlite; all HTTP,
auth, size-limit, scope, malformed-body, and heartbeat cases pass through the
minimal fake.

- [ ] **Step 5: Prove copied lifecycle logic is gone**

Run:

```bash
! rg -n "runStatusForTest|runTimestampsForTest|isTerminalRunEventForTest|getRun" \
  apps/api/src/test/ingest.test.ts
```

Expected: exit 0 from the negated search and no output.

- [ ] **Step 6: Commit the test migration**

```bash
git add apps/api/src/test/ingest-store.test.ts apps/api/src/test/ingest.test.ts
git commit -m "test: cover ingest lifecycle in PostgreSQL"
```

---

### Task 3: Keep synthetic parents lifecycle-neutral

**Files:**
- Modify: `apps/api/src/test/ingest-store.test.ts`
- Modify: `apps/api/src/services/ingest-service.ts:80-88`

**Interfaces:**
- Consumes: production PGlite contract, `runRelations`, and the existing SQL rule that preserves `excluded.status = 'unknown'`.
- Produces: synthetic parent event with `type: "run.updated"` and `status: "unknown"`; unchanged child event and idempotent relation.

- [ ] **Step 1: Write the failing parent lifecycle regression**

Import `runRelations`, then add:

```ts
  it("does not complete a running parent when its child completes", async () => {
    await ingestBatch(
      store(),
      makeBatch("00000000-0000-4000-8000-000000000211", {
        event_id: "event-parent-started",
        source_event_id: "source-parent-started",
        source_run_id: "parent-run",
        type: "run.started",
        status: "running",
        occurred_at: "2026-01-01T10:00:00.000Z",
      }),
    );

    await ingestBatch(
      store(),
      makeBatch("00000000-0000-4000-8000-000000000212", {
        event_id: "event-child-completed",
        source_event_id: "source-child-completed",
        source_run_id: "child-run",
        parent_source_run_id: "parent-run",
        type: "run.completed",
        status: "completed",
        occurred_at: "2026-01-01T10:05:00.000Z",
      }),
    );

    const parent = await readRun("parent-run");
    const child = await readRun("child-run");
    const relations = await fixture.db.select().from(runRelations);

    expect(parent).toMatchObject({
      status: "running",
      completedAt: null,
    });
    expect(child).toMatchObject({
      status: "completed",
      completedAt: new Date("2026-01-01T10:05:00.000Z"),
    });
    expect(relations).toEqual([
      expect.objectContaining({
        parentRunId: parent?.id,
        childRunId: child?.id,
        relationType: "parent",
      }),
    ]);
  });
```

- [ ] **Step 2: Run the regression and verify the current bug**

Run:

```bash
pnpm --filter @alfred/api exec vitest run \
  src/test/ingest-store.test.ts \
  -t "does not complete a running parent"
```

Expected: FAIL because the parent is `completed` and has the child's terminal
timestamp.

- [ ] **Step 3: Neutralize the event at the synthesis boundary**

In the existing parent object in `ingestBatch`, add the explicit type next to
the explicit status:

```ts
            event_id: `${event.event_id}:parent`,
            type: "run.updated",
            status: "unknown",
```

Do not reorder `runStatusFor`, special-case parent IDs in SQL, or modify the
original child event.

- [ ] **Step 4: Run the parent regression and full store suite**

Run:

```bash
pnpm --filter @alfred/api exec vitest run src/test/ingest-store.test.ts
pnpm --filter @alfred/api typecheck
```

Expected: parent remains running without `completedAt`, child is completed,
one relation exists, and every production-store lifecycle test stays green.

- [ ] **Step 5: Commit the root-cause fix**

```bash
git add apps/api/src/services/ingest-service.ts \
  apps/api/src/test/ingest-store.test.ts
git commit -m "fix: preserve parent run lifecycle"
```

---

### Task 4: Fail hosted startup on invalid database configuration

**Files:**
- Modify: `apps/api/src/test/env.test.ts`
- Modify: `apps/api/src/env.ts:4-57`
- Modify: `apps/api/src/test/app.test.ts:11-29,44-48`
- Modify: `apps/api/src/app.ts:1-15`

**Interfaces:**
- Consumes: existing `isHostedRuntime`, Zod environment parsing, `createPool(connectionString?)`, and `createDb(pool?)`.
- Produces: parsed `DATABASE_URL?: string`; hosted fail-closed behavior; explicit `createPool(env.DATABASE_URL)` wiring.

- [ ] **Step 1: Add failing local and hosted URL regressions**

At the top of `env.test.ts`, define:

```ts
const hostedEnv = {
  NODE_ENV: "production",
  RUNNER_DEVICE_TOKEN: "fixture-runner-token",
} satisfies NodeJS.ProcessEnv;
```

Add:

```ts
  it("keeps DATABASE_URL optional outside hosted runtime", () => {
    const parsed = parseApiEnv({
      NODE_ENV: "development",
      RUNNER_DEVICE_TOKEN: "token",
    });
    expect(parsed.DATABASE_URL).toBeUndefined();
  });

  it("requires DATABASE_URL in hosted runtime", () => {
    expect(() => parseApiEnv(hostedEnv)).toThrow(/DATABASE_URL/);
  });

  it.each([
    "not-a-url",
    "https://database.example.test/alfred",
  ])("rejects hosted non-PostgreSQL DATABASE_URL %s", (DATABASE_URL) => {
    expect(() => parseApiEnv({ ...hostedEnv, DATABASE_URL }))
      .toThrow(/DATABASE_URL|postgres/i);
  });

  it("accepts a hosted PostgreSQL DATABASE_URL", () => {
    expect(
      parseApiEnv({
        ...hostedEnv,
        DATABASE_URL: "postgresql://alfred:secret@db.example.test:5432/alfred",
      }),
    ).toMatchObject({
      DATABASE_URL: "postgresql://alfred:secret@db.example.test:5432/alfred",
    });
  });
```

Add a valid fixture `DATABASE_URL` to the existing hosted dev-auth test and
the retired browser-config test so each continues to isolate its original
assertion.

- [ ] **Step 2: Run environment tests and verify missing validation**

Run:

```bash
pnpm --filter @alfred/api exec vitest run src/test/env.test.ts
```

Expected: hosted missing and invalid URL tests fail because `DATABASE_URL` is
not parsed.

- [ ] **Step 3: Validate URL syntax, protocol, and hosted presence**

Above `createEnvSchema`, add:

```ts
const DatabaseUrl = z
  .string()
  .url()
  .refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    },
    { message: "DATABASE_URL must use postgres: or postgresql:" },
  );
```

Add this field to the object returned by `createEnvSchema`:

```ts
    DATABASE_URL: DatabaseUrl.optional(),
```

After parsing and before the existing hosted dev-auth check, add:

```ts
  const hostedRuntime = isHostedRuntime(input);

  if (hostedRuntime && !parsed.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in hosted runtime");
  }

  const hostedDevAuth = parsed.DEV_AUTH_ENABLED && hostedRuntime;
```

Replace the old `hostedDevAuth` declaration rather than calling
`isHostedRuntime` twice. Do not add a default URL to the environment schema;
the existing local fallback remains owned by `createPool`.

- [ ] **Step 4: Prove `createApp` passes the parsed URL**

In `app.test.ts`, replace the single `dbMock` declaration with:

```ts
const dbMocks = vi.hoisted(() => ({
  db: {},
  pool: {},
  createDb: vi.fn(),
  createPool: vi.fn(),
}));
```

Update the `@alfred/db` mock:

```ts
  createDb: dbMocks.createDb,
  createPool: dbMocks.createPool,
```

In `beforeEach`, add:

```ts
    dbMocks.createPool.mockReset();
    dbMocks.createPool.mockReturnValue(dbMocks.pool);
    dbMocks.createDb.mockReset();
    dbMocks.createDb.mockReturnValue(dbMocks.db);
```

Because this test environment has no `DATABASE_URL`, add:

```ts
  it("constructs the database from the parsed DATABASE_URL", () => {
    createApp();
    expect(dbMocks.createPool).toHaveBeenCalledWith(undefined);
    expect(dbMocks.createDb).toHaveBeenCalledWith(dbMocks.pool);
  });
```

Run:

```bash
pnpm --filter @alfred/api exec vitest run src/test/app.test.ts \
  -t "constructs the database"
```

Expected: FAIL because `createApp` calls `createDb()` without constructing the
pool from `env.DATABASE_URL`.

- [ ] **Step 5: Wire the validated value into the existing pool**

Change the app import and database construction:

```ts
import { createDb, createPool } from "@alfred/db";
```

```ts
  const db = createDb(createPool(env.DATABASE_URL));
```

This explicit `undefined` preserves the current local default parameter while
a hosted process cannot reach this line without a validated URL.

- [ ] **Step 6: Run environment, app, and full API tests**

Run:

```bash
pnpm --filter @alfred/api exec vitest run \
  src/test/env.test.ts \
  src/test/app.test.ts
pnpm --filter @alfred/api test
pnpm --filter @alfred/api typecheck
pnpm --filter @alfred/api build
```

Expected: local parsing remains valid, every hosted invalid case names the
database setting, app construction uses the parsed field, and the complete API
package is green.

- [ ] **Step 7: Commit hosted database validation**

```bash
git add apps/api/src/env.ts apps/api/src/test/env.test.ts \
  apps/api/src/app.ts apps/api/src/test/app.test.ts
git commit -m "fix: require hosted database configuration"
```

---

### Task 5: Verify, observe, review, and close S6

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-phase-s6-ingest-api-correctness-design.md`
- Modify: `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Interfaces:**
- Consumes: committed Tasks 1–4 and the phase gates in the parent roadmap.
- Produces: fresh verification evidence, direct failure-path observation, focused boundary review, S6 closeout, and S7 handoff.

- [ ] **Step 1: Run the focused S6 gate**

Run:

```bash
pnpm --filter @alfred/api exec vitest run \
  src/test/ingest-store.test.ts \
  src/test/ingest.test.ts \
  src/test/env.test.ts \
  src/test/app.test.ts
pnpm --filter @alfred/api typecheck
pnpm --filter @alfred/api build
```

Expected: all focused files pass; API typecheck and build report no errors.

- [ ] **Step 2: Check dependency and scope boundaries**

Run:

```bash
git diff main...HEAD -- apps/api/package.json pnpm-lock.yaml
git diff --name-only main...HEAD
git diff --check main...HEAD
```

Expected:

- the only new package is API-dev-only `@electric-sql/pglite`;
- no production schema or migration file changed;
- no desktop, browser-auth, device-auth contract, query-route, or global-style
  file changed;
- the diff has no whitespace errors.

- [ ] **Step 3: Run the full repository gate**

Run:

```bash
pnpm verify
```

Expected: lint, repository typecheck, all tests, build, and Electron smoke
pass. Do not close S6 on a stale or partial gate.

- [ ] **Step 4: Observe hosted startup failing before listen**

Build once, then run a hosted process with a fixture token and no database URL:

```bash
pnpm --filter @alfred/api build
S6_LOG="$(mktemp /tmp/alfred-s6-missing-db.XXXXXX.log)"
set +e
env -u DATABASE_URL \
  NODE_ENV=production \
  RUNNER_DEVICE_TOKEN=fixture-runner-token \
  pnpm --filter @alfred/api exec node dist/index.js \
  >"$S6_LOG" 2>&1
S6_EXIT=$?
set -e
test "$S6_EXIT" -ne 0
rg "DATABASE_URL" "$S6_LOG"
! rg "fixture-runner-token" "$S6_LOG"
```

Expected: nonzero exit before `Alfred API listening`, output identifies
`DATABASE_URL`, and the fixture token is absent. Record the command and
redacted result in the closeout; remove the temporary log afterward.

- [ ] **Step 5: Perform the focused review**

Review `git diff main...HEAD` against the accepted contract and record
findings by severity. Confirm explicitly:

- PGlite invokes `createDrizzleIngestStore`, not a copied implementation;
- canonical migrations are the only test schema authority;
- every PGlite instance closes after each test;
- parent synthesis cannot inherit terminal type or timestamp;
- real child event persistence remains unchanged;
- local DB fallback remains and hosted fallback is unreachable;
- URL errors do not print credentials;
- no `/health` readiness behavior was added.

Fix every Critical and Important finding, rerun the narrow affected test, then
rerun `pnpm verify`. Route any accepted Minor finding explicitly instead of
silently ignoring it.

- [ ] **Step 6: Record closeout evidence**

In the S6 design document:

- change status to `Complete`;
- add implementation commit IDs;
- record focused test, API typecheck/build, full `pnpm verify`, runtime
  observation, and focused-review results;
- state that no production migration, UI, browser auth, or readiness behavior
  changed.

In the parent roadmap:

- change S6 from `Pending` to `Complete`;
- mark findings 12, 20, and 21 closed with their commit IDs;
- append an `S6 closeout` section with the same fresh evidence;
- set the next phase to `S7 — Residue and blocked-boundary review`;
- leave S1–S5 closeouts unchanged.

- [ ] **Step 7: Commit closeout documentation**

```bash
git add \
  docs/superpowers/specs/2026-07-31-phase-s6-ingest-api-correctness-design.md \
  docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
git commit -m "docs: close S6 ingest API correctness"
```

- [ ] **Step 8: Confirm final branch state**

Run:

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
```

Expected: clean `s6-ingest-api-correctness` worktree with two planning commits,
four implementation commits, and one closeout commit. Do not push or integrate
without Patryk's explicit authorization.
