# Phase S2 — Runner Loss and Stall Prevention

**Status:** Approved

**Date:** 2026-07-29

**Owner:** `main`

**Parent:** `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Findings:** 6, 7, 8, 24

## Summary

Alfred's local runner must keep synchronizing healthy events when one source
record, source adapter, queued payload, or API batch is invalid. Concurrent
Codex and Claude sessions must advance independently so a faster session cannot
silently suppress later events from a slower session.

This phase replaces the source-wide timestamp watermark with one cursor per
session file, isolates source conversion failures per record, keeps outbox
flush independent from collection failures, and moves permanently rejected
events to a durable local quarantine instead of deleting them.

## Problem

The runner currently has four coupled failure modes:

1. one record that parses as JSON but cannot become an `IngestEvent` rejects the
   entire adapter collection;
2. adapter collection happens before outbox flush in the same failure path, so
   already queued events remain stuck;
3. one cursor per source uses the maximum timestamp across concurrently written
   session files and permanently skips slower sessions;
4. invalid or identity-mismatched queued records are silently deleted, while a
   permanently rejected batch retries forever.

The result is missing activity in Alfred with no reliable diagnostic trail.

## Goals

- Continue collecting after one malformed or schema-invalid source record.
- Normalize valid ISO timestamps with offsets to canonical UTC before schema
  validation.
- Continue collecting other adapters when one adapter fails.
- Flush the existing outbox even when collection fails.
- Track progress independently for every session file.
- Ensure a permanently rejected event cannot block healthy records behind it.
- Preserve every discarded queued payload in local SQLite with an explicit
  reason.
- Emit diagnostics that identify the source or event without logging payloads,
  device tokens, prompts, or transcript content.

## Non-goals

- No API schema, hosted database, or device-auth changes.
- No runner UI or dead-letter management screen.
- No replay command for quarantined events in S2.
- No reading the real `~/.codex` or `~/.claude` during tests.
- No migration of historical source-wide cursor rows.
- No arbitrary retry cap for network, authentication, rate-limit, or server
  failures.
- No general refactor of the runner, adapters, or SQLite wrapper.

## User stories

- As a user running several agents concurrently, I want activity from a slower
  session to remain visible after a faster session advances.
- As an operator, I want one malformed external record to be reported without
  stopping healthy source files or already queued delivery.
- As an operator investigating rejected telemetry, I want the original queued
  payload preserved locally with a stable reason instead of silently deleted.

## Behavior contract

### Source collection

- `SourceAdapter.collect()` returns both normalized events and cursor updates:

```ts
export type SourceCursorUpdate = {
  key: string;
  value: string;
};

export type SourceCollection = {
  events: IngestEvent[];
  cursorUpdates: SourceCursorUpdate[];
};
```

- Codex and Claude derive a stable cursor key from the source ID and the session
  file's path relative to its configured source home:

```ts
JSON.stringify([sourceId, relativeSessionPath])
```

- The configured `codexSince` or `claudeSince` remains a lower bound for every
  session file. The stored per-file cursor may only move that bound forward.
- A cursor is persisted only after all returned events for the collection have
  been enqueued. A crash before the cursor write may cause a safe reread; event
  IDs keep the outbox and API idempotent.
- A parseable timestamp such as `2026-04-28T12:00:00+02:00` is normalized to
  `2026-04-28T10:00:00.000Z`.
- A record that still cannot produce a valid event is skipped, counted through
  a warning, and does not abort the remaining records or files. The original
  source file remains the source of truth.
- An adapter-level I/O failure is retained as an iteration error, but collection
  continues for other adapters and the outbox is flushed before the error is
  surfaced.

### Cursor rollout

- Existing `source_cursors` storage remains unchanged. Its key column stores the
  new composite key.
- Old source-wide keys such as `codex-cli` and `claude-code` are ignored by the
  new adapters and remain harmless.
- The first run after upgrade may reread historical files once. Stable event IDs
  and server-side idempotency prevent duplicate activity.
- Rolling back to the previous binary ignores the new composite keys and uses
  the last old source-wide cursor. This may reread events but does not require a
  database rollback.

### Durable quarantine

The existing runner SQLite database gains an idempotently created
`outbox_dead_letters` table:

| Column | Contract |
|---|---|
| `id` | local integer primary key |
| `event_id` | unique original event ID |
| `payload` | exact queued JSON payload |
| `attempts` | retry count at quarantine time |
| `reason` | stable reason code |
| `created_at` | original outbox creation time |
| `quarantined_at` | quarantine time |

Moving an event to quarantine inserts the complete record and deletes it from
`outbox_events` in one SQLite transaction. `enqueue()` does not re-add an event
whose ID already exists in quarantine.

Stable reasons:

- `invalid_payload` — queued JSON does not satisfy `IngestEventSchema`;
- `identity_mismatch` — queued workspace or device differs from the active
  runner configuration;
- `permanent_ingest_rejection` — the API permanently rejects the event when
  sent alone.

There is no automatic quarantine deletion in S2. The existing unused
`pruneFailedBefore()` method is removed rather than connected to a silent
destructive path.

### Outbox delivery

- A locally invalid or identity-mismatched record is quarantined immediately,
  logged by event ID and reason, and counted as processed so the flush loop
  continues.
- A successful batch is marked sent exactly as today.
- HTTP `400`, `413`, and `422` are event-content rejections. The worker retries
  that batch as single-event batches:
  - accepted singleton events are marked sent;
  - a singleton rejected with `400`, `413`, or `422` is quarantined;
  - a singleton that receives a retryable failure remains queued with backoff.
- Network errors and HTTP `401`, `403`, `404`, `408`, `429`, and `5xx` are not
  quarantined. They remain queued and use the existing capped exponential
  backoff.
- The worker returns both sent and quarantined counts internally. Public runner
  iteration results continue reporting only `collectedEvents` and
  `flushedEvents`, where `flushedEvents` means accepted by the API.

### Diagnostics

- `RunRunnerOptions` gains an optional `onWarning(message: string)` callback.
- Default CLI execution routes warnings to `console.warn`.
- Warning messages may contain source ID, relative session path, record index,
  event ID, and a stable reason.
- Warning messages must not contain raw source records, queued payloads,
  authorization headers, device tokens, prompts, or transcript content.

## Success criteria

| Measure | Target | Evidence |
|---|---:|---|
| Offset timestamp record | normalized and collected | adapter regression |
| Invalid source record followed by valid record | valid record collected | Codex and Claude regressions |
| Concurrent session files | later event from slower file collected | real-filesystem runner regression |
| Adapter throws with queued outbox data | queued data still flushed | real-SQLite runner regression |
| Mixed permanently rejected batch | healthy events sent, poison event quarantined | worker regression |
| Invalid or wrong-identity queued record | payload preserved and warning emitted | real-SQLite regression |
| Runner package | tests, typecheck, and build pass | package gates |
| Repository | `pnpm verify` passes | phase gate |

## Rollout and recovery

1. Create the quarantine table through `CREATE TABLE IF NOT EXISTS` when the
   runner opens its existing SQLite database.
2. Start using per-file composite cursor keys without rewriting old keys.
3. Expect one safe historical reread after upgrade.
4. Preserve quarantine indefinitely during S2; inspect the local database if a
   recovery is required.
5. Rollback requires only restoring the previous binary. The previous binary
   ignores the additional table and composite cursor rows.

## Acceptance gate

- Targeted tests must use temporary Codex/Claude homes and a temporary real
  SQLite outbox.
- Tests must include the negative paths for invalid records, identity mismatch,
  permanent API rejection, transient API failure, and adapter I/O failure.
- Run `pnpm --filter @alfred/runner test`, typecheck, and build.
- Run `pnpm verify`.
- Perform a focused review of cursor key stability, transactionality of
  quarantine, payload-free diagnostics, and retry classification.
- No visual observation is required because S2 has no user-interface change.

## Open questions

None block S2. Replay tooling, retention policy, and a quarantine UI remain
explicitly deferred until operational evidence shows they are needed.
