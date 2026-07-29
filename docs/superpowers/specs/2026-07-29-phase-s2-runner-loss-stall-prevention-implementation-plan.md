# Phase S2 Runner Loss and Stall Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent malformed source records, concurrent-session cursors, and
permanently rejected outbox events from losing data or stalling runner sync.

**Architecture:** Keep the existing runner, adapters, outbox SQLite file, and
device-auth ingest API. Make adapters return events plus per-file cursor
updates, isolate record conversion failures, preserve rejected queued records
in a transactional dead-letter table, and decompose permanently rejected
batches into singleton requests so healthy events still sync.

**Tech Stack:** TypeScript, Node.js, Vitest, better-sqlite3, Zod schemas from
`@alfred/schema`.

## Global Constraints

- Electron remains the only user client; S2 changes no user interface.
- Keep runner Bearer device-token authentication unchanged.
- Do not add dependencies.
- Do not read the real `~/.codex` or `~/.claude` in tests.
- Do not change the hosted API schema or database schema.
- Do not log source payloads, queued payloads, prompts, transcripts, or tokens.
- Preserve queued poison records in local SQLite before removing them.
- Network, authentication, rate-limit, and server failures must remain
  retryable.
- Use one focused commit per task.
- Run the full `pnpm verify` gate before phase closeout.

---

## File map

- `apps/runner/src/sources/source-adapter.ts` — collection result and cursor
  update contract.
- `apps/runner/src/sources/source-cursor.ts` — composite cursor key and timestamp
  floor helpers shared by the runner and both adapters.
- `apps/runner/src/sources/codex/codex-adapter.ts` — per-record isolation and
  per-file Codex cursor.
- `apps/runner/src/sources/claude/claude-adapter.ts` — per-record isolation and
  per-file Claude cursor.
- `apps/runner/src/outbox/outbox-db.ts` — outbox, cursor, and transactional
  quarantine storage.
- `apps/runner/src/outbox/outbox-worker.ts` — validation, batch decomposition,
  quarantine, retry, and flush accounting.
- `apps/runner/src/sync/ingest-client.ts` — typed HTTP failure needed for retry
  classification.
- `apps/runner/src/index.ts` — adapter orchestration, cursor persistence,
  collection-error isolation, warnings, and repeated flush.
- `apps/runner/src/test/codex-adapter.test.ts` — Codex malformed/offset record
  regressions.
- `apps/runner/src/test/claude-adapter.test.ts` — Claude malformed/offset record
  regressions.
- `apps/runner/src/test/outbox.test.ts` — real-SQLite cursor and quarantine
  regressions.
- `apps/runner/src/test/ingest-client.test.ts` — typed HTTP error regression.
- `apps/runner/src/test/runner-loop.test.ts` — end-to-end runner/outbox failure
  paths with temporary homes and SQLite.
- `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md` — S2
  closeout and S3 handoff.

### Task 1: Isolate invalid source records and normalize offset timestamps

**Findings:** 6

**Files:**
- Modify: `apps/runner/src/sources/codex/codex-adapter.ts`
- Modify: `apps/runner/src/sources/claude/claude-adapter.ts`
- Test: `apps/runner/src/test/codex-adapter.test.ts`
- Test: `apps/runner/src/test/claude-adapter.test.ts`

**Interfaces:**
- Consumes: current adapter config and `IngestEventSchema`.
- Produces: optional `onWarning(message: string)` on both adapter configs;
  record-local failures no longer reject `collectCodexEvents()` or
  `collectClaudeEvents()`.

- [ ] **Step 1: Add failing Codex and Claude regressions**

For each adapter, create a temporary session file containing:

1. a record whose parseable timestamp uses `+02:00`;
2. a record with an unparseable timestamp and a secret sentinel in another
   field;
3. a later valid record.

Pass `onWarning: (message) => warnings.push(message)` and assert:

```ts
expect(events.map((event) => event.occurred_at)).toContain(
  "2026-04-28T10:00:00.000Z",
);
expect(events.some((event) => event.source_event_id === "valid-after-invalid"))
  .toBe(true);
expect(warnings).toHaveLength(1);
expect(warnings[0]).not.toContain("secret source payload");
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm --filter @alfred/runner test -- codex-adapter.test.ts claude-adapter.test.ts
```

Expected: FAIL because offset timestamps reach the offset-rejecting schema and
the thrown parse aborts collection.

- [ ] **Step 3: Normalize timestamps before event construction**

In both record converters, after `Date.parse()` succeeds, pass canonical UTC to
event construction:

```ts
const normalizedOccurredAt = new Date(occurredAtMs).toISOString();
```

Use `normalizedOccurredAt` for `parseEvent()` and generated source event IDs
that currently include the timestamp.

- [ ] **Step 4: Catch conversion failures per record**

Add this field to both `CodexAdapterConfig` and `ClaudeAdapterConfig`:

```ts
onWarning?: (message: string) => void;
```

Warn and skip a record whose required timestamp is not parseable:

```ts
if (Number.isNaN(occurredAtMs)) {
  config.onWarning?.(
    `Skipped invalid ${sourceId} record in ${relative(configuredHome, file)} at index ${index}`,
  );
  return null;
}
```

Wrap each call that normalizes and parses an event in `try/catch`; emit the same
payload-free warning and continue the surrounding record loop on failure.
Apply the same protection to Claude's synthesized `run.started` event. Do not
include the raw record or exception payload in the warning.

- [ ] **Step 5: Run focused checks**

```bash
pnpm --filter @alfred/runner test -- codex-adapter.test.ts claude-adapter.test.ts
pnpm --filter @alfred/runner typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/runner/src/sources/codex/codex-adapter.ts apps/runner/src/sources/claude/claude-adapter.ts apps/runner/src/test/codex-adapter.test.ts apps/runner/src/test/claude-adapter.test.ts
git commit -m "fix(runner): isolate invalid source records"
```

### Task 2: Replace source-wide watermarks with per-file cursors

**Findings:** 7

**Files:**
- Create: `apps/runner/src/sources/source-cursor.ts`
- Modify: `apps/runner/src/sources/source-adapter.ts`
- Modify: `apps/runner/src/sources/codex/codex-adapter.ts`
- Modify: `apps/runner/src/sources/claude/claude-adapter.ts`
- Modify: `apps/runner/src/index.ts`
- Test: `apps/runner/src/test/outbox.test.ts`
- Test: `apps/runner/src/test/runner-loop.test.ts`

**Interfaces:**
- Produces:

```ts
export type SourceCursorUpdate = { key: string; value: string };
export type SourceCollection = {
  events: IngestEvent[];
  cursorUpdates: SourceCursorUpdate[];
};
export type SourceAdapter = {
  sourceId: string;
  collect(): Promise<SourceCollection>;
};
```

- Produces `sourceCursorKey(sourceId, relativeSessionPath): string` and
  `newestCursor(configuredSince, storedCursor): string | undefined`.
- Consumes existing `OutboxDb.getSourceCursor()` and `setSourceCursor()`.

- [ ] **Step 1: Replace the source-cursor storage test**

In `outbox.test.ts`, replace "stores one cursor per source" with composite key
coverage:

```ts
const first = sourceCursorKey("codex-cli", "sessions/a.jsonl");
const second = sourceCursorKey("codex-cli", "sessions/b.jsonl");
outbox.setSourceCursor(first, "2026-04-28T10:00:00.000Z");
outbox.setSourceCursor(second, "2026-04-28T09:00:00.000Z");

expect(outbox.getSourceCursor(first)).toBe("2026-04-28T10:00:00.000Z");
expect(outbox.getSourceCursor(second)).toBe("2026-04-28T09:00:00.000Z");
expect(first).not.toBe(second);
```

- [ ] **Step 2: Add the concurrent-session loss regression**

In `runner-loop.test.ts`, create two Codex files under a temporary `codexHome`.
Session A ends at `10:00`; session B initially ends at `09:00`. Run the real
default adapter once, append a valid B event at `09:30`, then run again:

```ts
const laterBRecord = {
  timestamp: "2026-04-28T09:30:00.000Z",
  type: "event_msg",
  payload: {
    type: "task_complete",
    turn_id: "session-b-later",
  },
};

await expect(runRunnerOnce(config, { fetchImpl })).resolves.toMatchObject({
  collectedEvents: 2,
});

appendFileSync(sessionB, `\n${JSON.stringify(laterBRecord)}`);

await expect(runRunnerOnce(config, { fetchImpl })).resolves.toMatchObject({
  collectedEvents: 1,
  flushedEvents: 1,
});
```

Assert the final request contains B's `09:30` event. This must use temporary
files and the real `OutboxDb`, not a mocked adapter.

- [ ] **Step 3: Run the regression and verify failure**

```bash
pnpm --filter @alfred/runner test -- runner-loop.test.ts -t "keeps independent cursors"
```

Expected: FAIL because the first run stores the source-wide `10:00` watermark
and filters B's later `09:30` record.

- [ ] **Step 4: Add the shared cursor contract**

Create `source-cursor.ts`:

```ts
export function sourceCursorKey(
  sourceId: string,
  relativeSessionPath: string,
): string {
  return JSON.stringify([sourceId, relativeSessionPath]);
}

export function newestCursor(
  configuredSince: string | undefined,
  storedCursor: string | null,
): string | undefined {
  if (!configuredSince) return storedCursor ?? undefined;
  if (!storedCursor) return configuredSince;

  const configuredMs = Date.parse(configuredSince);
  const storedMs = Date.parse(storedCursor);
  if (Number.isNaN(configuredMs)) return storedCursor;
  if (Number.isNaN(storedMs)) return configuredSince;
  return storedMs > configuredMs ? storedCursor : configuredSince;
}
```

Change `SourceAdapter.collect()` to return `SourceCollection`.

- [ ] **Step 5: Produce cursor updates inside each adapter**

Add to both adapter configs:

```ts
getCursor?: (key: string) => string | null;
```

For every sorted session file:

1. derive a path relative to `codexHome` or `claudeHome`;
2. create its composite key;
3. combine the configured lower bound with `getCursor?.(key)`;
4. collect only events after that bound;
5. add one cursor update containing the maximum emitted `occurred_at` for that
   file.

Return `{ events, cursorUpdates }`. Do not advance a file cursor when that file
emits no valid event.

- [ ] **Step 6: Persist cursor updates only after enqueue**

In `index.ts`, remove source-wide `getSourceCursor()` and
`updateSourceCursor()`. Default adapter factories pass
`getCursor: (key) => outbox.getSourceCursor(key)`.

For each collection:

```ts
for (const event of collection.events) {
  outbox.enqueue(redactEvent(event, config.privacyMode));
}
for (const cursor of collection.cursorUpdates) {
  outbox.setSourceCursor(cursor.key, cursor.value);
}
```

Update mocked adapters in tests to return `{ events, cursorUpdates: [] }`.

- [ ] **Step 7: Run runner checks**

```bash
pnpm --filter @alfred/runner test
pnpm --filter @alfred/runner typecheck
```

Expected: PASS, including the concurrent-session regression.

- [ ] **Step 8: Commit**

```bash
git add apps/runner/src/sources/source-cursor.ts apps/runner/src/sources/source-adapter.ts apps/runner/src/sources/codex/codex-adapter.ts apps/runner/src/sources/claude/claude-adapter.ts apps/runner/src/index.ts apps/runner/src/test/outbox.test.ts apps/runner/src/test/runner-loop.test.ts
git commit -m "fix(runner): track cursors per session file"
```

### Task 3: Preserve discarded outbox records in SQLite quarantine

**Findings:** 8, 24

**Files:**
- Modify: `apps/runner/src/outbox/outbox-db.ts`
- Test: `apps/runner/src/test/outbox.test.ts`

**Interfaces:**
- Produces:

```ts
export type OutboxQuarantineReason =
  | "invalid_payload"
  | "identity_mismatch"
  | "permanent_ingest_rejection";

OutboxDb.quarantine(
  id: number,
  reason: OutboxQuarantineReason,
  now?: Date,
): void;
```

- Removes unused `OutboxDb.pruneFailedBefore()`.

- [ ] **Step 1: Add a real-SQLite quarantine regression**

Expose the temporary database path from the test helper. Enqueue one payload,
list its record, and quarantine it:

```ts
outbox.quarantine(
  record.id,
  "invalid_payload",
  new Date("2026-04-28T11:00:00.000Z"),
);
expect(outbox.countQueued()).toBe(0);
```

After closing `OutboxDb`, open the same path with `better-sqlite3` and assert:

```ts
expect(
  db.prepare(`
    SELECT event_id, payload, attempts, reason, created_at, quarantined_at
    FROM outbox_dead_letters
  `).get(),
).toMatchObject({
  event_id: "event-1",
  reason: "invalid_payload",
  attempts: 0,
  quarantined_at: "2026-04-28T11:00:00.000Z",
});
```

Parse `payload` and verify the original event is intact.

- [ ] **Step 2: Add a no-reenqueue regression**

After quarantining `event-1`, call `enqueue()` again with the same event ID and
assert `countQueued()` remains zero and the dead-letter row remains one.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm --filter @alfred/runner test -- outbox.test.ts
```

Expected: FAIL because the table and `quarantine()` do not exist.

- [ ] **Step 4: Create the table and transactional move**

Create `outbox_dead_letters` in the existing constructor `db.exec()` with the
columns from the spec and a unique `event_id`.

Implement `quarantine()` with one `better-sqlite3` transaction:

1. `INSERT INTO outbox_dead_letters ... SELECT ... FROM outbox_events WHERE id = ?`;
2. `DELETE FROM outbox_events WHERE id = ?`.

Use `INSERT OR IGNORE` so the move is idempotent. Change `enqueue()` to skip an
event ID already present in `outbox_dead_letters`.

- [ ] **Step 5: Delete the unused destructive prune**

Remove `pruneFailedBefore()` and its old test. Do not replace it with automatic
dead-letter deletion.

- [ ] **Step 6: Run focused checks**

```bash
pnpm --filter @alfred/runner test -- outbox.test.ts
pnpm --filter @alfred/runner typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/runner/src/outbox/outbox-db.ts apps/runner/src/test/outbox.test.ts
git commit -m "fix(runner): quarantine rejected outbox records"
```

### Task 4: Isolate permanently rejected events during flush

**Findings:** 8, 24

**Files:**
- Modify: `apps/runner/src/sync/ingest-client.ts`
- Modify: `apps/runner/src/outbox/outbox-worker.ts`
- Modify: `apps/runner/src/index.ts`
- Test: `apps/runner/src/test/ingest-client.test.ts`
- Test: `apps/runner/src/test/runner-loop.test.ts`

**Interfaces:**
- Produces:

```ts
export class IngestRequestError extends Error {
  constructor(readonly status: number) {
    super(`Ingest failed with status ${status}`);
    this.name = "IngestRequestError";
  }
}

export type FlushOutboxResult = {
  sent: number;
  quarantined: number;
};
```

- Adds `onWarning?: (message: string) => void` to `FlushOutboxConfig`.

- [ ] **Step 1: Add typed ingest failure coverage**

Update the non-accepted response test:

```ts
await expect(postIngestBatch(config, batch)).rejects.toMatchObject({
  name: "IngestRequestError",
  status: 400,
  message: "Ingest failed with status 400",
});
```

Keep heartbeat failures as ordinary errors because heartbeat status never
classifies event content.

- [ ] **Step 2: Add mixed invalid and identity-mismatch quarantine tests**

Replace "discards invalid records" with a test that queues:

1. one invalid payload;
2. one valid event for another workspace;
3. one valid active event.

Assert `flushOutboxOnce()` returns `{ sent: 1, quarantined: 2 }`, the active
event is posted, the queue is empty, two warnings contain only event IDs and
reason codes, and SQLite contains both quarantined payloads.

- [ ] **Step 3: Add permanent batch decomposition coverage**

Queue one poison event and two healthy events. Mock fetch so the initial
three-event request returns `400`; singleton requests return `202` for healthy
events and `400` for the poison event.

Assert:

```ts
expect(result).toEqual({ sent: 2, quarantined: 1 });
expect(outbox.countQueued()).toBe(0);
expect(warnings).toEqual([
  expect.stringContaining("poison-event"),
]);
```

Verify the poison payload exists in `outbox_dead_letters`.

- [ ] **Step 4: Add transient singleton coverage**

Use the same initial permanent batch rejection, then return `500` for one
singleton. Assert the healthy singleton is sent, the poison singleton is
quarantined, the transient singleton remains queued with `attempts: 1`, and the
worker rejects with the transient `IngestRequestError`.

- [ ] **Step 5: Implement typed HTTP failures**

Throw `new IngestRequestError(response.status)` from `postIngestBatch()`.
Classify only `400`, `413`, and `422` as permanent event-content responses:

```ts
function isPermanentEventRejection(error: unknown): boolean {
  return (
    error instanceof IngestRequestError &&
    (error.status === 400 || error.status === 413 || error.status === 422)
  );
}
```

- [ ] **Step 6: Quarantine local invalid records**

In the initial record loop:

- quarantine schema failures as `invalid_payload`;
- quarantine workspace/device mismatches as `identity_mismatch`;
- call `onWarning` with event ID and reason only;
- increment the internal quarantined count.

Do not call `markSent()` for these paths.

- [ ] **Step 7: Decompose permanent batch rejection**

On a permanent multi-event rejection, send each valid record as a fresh
single-event batch:

- success → `markSent`;
- permanent singleton rejection → `quarantine` with
  `permanent_ingest_rejection` and warn;
- other failure → `markFailed` with existing backoff and retain the first
  retryable error.

After processing every singleton, throw the retained retryable error if one
exists; otherwise return `{ sent, quarantined }`.

- [ ] **Step 8: Continue the flush loop after quarantine**

Change the private `flushOutbox()` in `index.ts` to aggregate
`FlushOutboxResult` and continue while `sent + quarantined > 0`. Keep
`runRunnerOnce()`'s public `flushedEvents` equal to the aggregate `sent` count.

- [ ] **Step 9: Run focused checks**

```bash
pnpm --filter @alfred/runner test -- ingest-client.test.ts runner-loop.test.ts
pnpm --filter @alfred/runner typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/runner/src/sync/ingest-client.ts apps/runner/src/outbox/outbox-worker.ts apps/runner/src/index.ts apps/runner/src/test/ingest-client.test.ts apps/runner/src/test/runner-loop.test.ts
git commit -m "fix(runner): isolate permanently rejected events"
```

### Task 5: Flush queued data despite adapter failures

**Findings:** 6

**Files:**
- Modify: `apps/runner/src/index.ts`
- Test: `apps/runner/src/test/runner-loop.test.ts`

**Interfaces:**
- Adds `onWarning?: (message: string) => void` to `RunRunnerOptions`.
- Consumes the `SourceCollection` and `FlushOutboxResult` contracts from Tasks
  2 and 4.

- [ ] **Step 1: Add the queued-data failure regression**

Seed the real SQLite outbox path with one valid event, then call
`runRunnerOnce()` with an adapter whose `collect()` throws:

```ts
await expect(
  runRunnerOnce(config, {
    fetchImpl,
    adapter: {
      sourceId: "codex-cli",
      collect: async () => {
        throw new Error("source unavailable");
      },
    },
  }),
).rejects.toThrow("Runner collection failed");
```

Assert fetch received the seeded event and a reopened outbox has zero queued
records.

- [ ] **Step 2: Add multiple-adapter isolation coverage**

Provide one throwing adapter and one adapter returning a valid event. Assert the
healthy adapter is still called and its event is sent before the aggregate
collection error is surfaced.

- [ ] **Step 3: Run the regressions and verify failure**

```bash
pnpm --filter @alfred/runner test -- runner-loop.test.ts -t "flushes queued data|continues other adapters"
```

Expected: FAIL because collection currently aborts before flush and before the
next adapter.

- [ ] **Step 4: Isolate adapter failures and flush before surfacing them**

In `runRunnerOnce()`:

1. collect each adapter inside its own `try/catch`;
2. retain errors without aborting later adapters;
3. enqueue events and persist cursor updates from successful collections;
4. flush the outbox;
5. send heartbeat only when no event was sent;
6. after flush/heartbeat, throw one `AggregateError` when collection errors
   exist.

Use:

```ts
throw new AggregateError(collectionErrors, "Runner collection failed");
```

- [ ] **Step 5: Route payload-free warnings**

Pass `options.onWarning` to both default adapters and the outbox worker. In the
CLI entry point, pass:

```ts
onWarning: (message) => console.warn(message),
```

Do not stringify error objects that may contain source data.

- [ ] **Step 6: Run runner package gates**

```bash
pnpm --filter @alfred/runner test
pnpm --filter @alfred/runner typecheck
pnpm --filter @alfred/runner build
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/runner/src/index.ts apps/runner/src/test/runner-loop.test.ts
git commit -m "fix(runner): flush outbox after collection failures"
```

### Task 6: Phase verification and closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: closed S2 and explicit handoff to S3.

- [ ] **Step 1: Run focused failure-path tests without real user homes**

```bash
pnpm --filter @alfred/runner test
```

Confirm the tests use only temporary Codex/Claude homes and temporary SQLite
files.

- [ ] **Step 2: Run runner typecheck and build**

```bash
pnpm --filter @alfred/runner typecheck
pnpm --filter @alfred/runner build
```

Expected: PASS.

- [ ] **Step 3: Run the repository gate**

```bash
pnpm verify
```

Expected: lint, typecheck, tests, build, and Electron smoke all PASS.

- [ ] **Step 4: Focused review**

Review only:

- cursor keys are stable and per session file;
- cursors advance after enqueue, never before;
- quarantine moves are transactional and preserve exact payloads;
- old global cursors are ignored without destructive migration;
- only `400`, `413`, and `422` trigger singleton decomposition;
- network/auth/rate-limit/server failures remain retryable;
- warnings contain identifiers and reasons but no payloads or secrets;
- no API, hosted schema, device-auth, desktop, or visual behavior changed.

- [ ] **Step 5: Close S2**

In the roadmap:

- set S2 to `Complete`;
- set S3 to `Next`;
- mark findings 6, 7, 8, and 24 closed with commit references;
- record focused gates and `pnpm verify`;
- preserve the S3 product-boundary decision unchanged.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
git commit -m "docs: close runner safety phase"
```

## Self-review

- Spec coverage: findings 6, 7, 8, and 24 each map to a failure-path
  regression and an explicit behavior.
- Placeholder scan: every code-changing step names the file, interface,
  command, expected failure, and accepted result.
- Type consistency: `SourceCollection`, `SourceCursorUpdate`,
  `OutboxQuarantineReason`, `IngestRequestError`, and `FlushOutboxResult` are
  defined once and consumed by later tasks under the same names.
- Simplicity: no dependency, hosted migration, replay tool, retention job, UI,
  or generic queue abstraction is added.
- Recovery: queued poison data moves transactionally into the same local SQLite
  file and remains available after rollback.
