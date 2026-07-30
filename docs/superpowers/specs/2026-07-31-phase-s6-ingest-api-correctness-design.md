# Phase S6 — Ingest/API Correctness

**Status:** Approved — implementation pending
**Parent:** `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`  
**Findings:** 12, 20, 21

## Objective

Test the production ingest store against PostgreSQL-compatible behavior,
prevent child lifecycle events from changing their parent's lifecycle, and
make a hosted API reject missing or invalid database configuration before it
starts serving traffic.

## Scope lineage

`Phase Z release closeout → post-v1 stabilization roadmap → S1–S5 complete → S6 active → S7 remains`

S6 closes only findings 12, 20, and 21. It does not reopen earlier product or
visual decisions and does not close the parent stabilization roadmap.

## Classification and route

- **Decision:** settled. Production ingest behavior is exercised with an
  embedded PGlite database using the canonical Drizzle schema and migrations.
- **Diagnosis:** known cause, revalidated against `main` after S5.
- **Execution:** Medium/coordinated. The work crosses API environment parsing,
  database construction, ingest persistence, and test infrastructure.
- **Risk:** Elevated. The affected path controls runner event persistence and
  hosted database configuration.
- **Simplicity posture:** Lean. Export one existing production seam, add one
  test-only database dependency, reuse current migrations, and keep route
  fakes limited to HTTP/auth orchestration. Do not add a repository layer,
  factory hierarchy, new production schema, or compatibility path.
- **Workflow after approval:** Planned. One implementation plan covers S6.

## Current evidence

### Finding 12 — tests bypass the production ingest store

`apps/api/src/services/ingest-service.ts` contains the Drizzle implementation
behind the private `createDrizzleIngestStore`. The lifecycle and duplicate
tests in `apps/api/src/test/ingest.test.ts` instead use `makeInMemoryStore`,
which reimplements status, timestamp, conflict, and duplicate behavior.

A bug in the production SQL can therefore pass the suite as long as the test
copy remains internally consistent.

### Finding 20 — a child terminal event clobbers its parent

When `parent_source_run_id` is present, `ingestBatch` spreads the child event
to synthesize the parent and changes only its identifiers and
`status: "unknown"`. The child `type` and terminal `occurred_at` remain.

`runStatusFor` checks terminal event types before the explicit status. A
completed child therefore gives the synthetic parent `completed`, bypassing
the existing SQL guard that preserves a run when the excluded status is
`unknown`. `runTimestampsFor` also derives a terminal timestamp from the
inherited child type.

### Finding 21 — hosted database configuration falls back locally

`apps/api/src/env.ts` validates the API's other runtime inputs but omits
`DATABASE_URL`. `packages/db/src/client.ts` consequently falls back to the
local development URL when a hosted deployment is misconfigured.

The API can start and answer `/health` while every data route fails to connect
to a local PostgreSQL instance that does not exist.

## Accepted behavior

### 1. Production ingest has a PostgreSQL-compatible contract test

- `createDrizzleIngestStore` becomes a narrow exported test seam. Its runtime
  implementation and `ingestBatch` call path remain the same.
- `@electric-sql/pglite` is an API development dependency only.
- A focused test helper creates an in-memory PGlite instance, wraps it with
  `drizzle-orm/pglite`, supplies the canonical `@alfred/db` schema, applies the
  repository's existing `drizzle/` migrations, and closes the instance after
  the test.
- Lifecycle, ordering, and duplicate tests call `ingestBatch` through the
  exported production store and inspect persisted rows through Drizzle.
- Tests use a fresh database for isolation. They do not share state with a
  developer PostgreSQL instance or require Docker.
- HTTP parsing, device-auth, size-limit, and route-mounting tests may keep a
  lightweight `IngestStore` fake. That fake returns only the data needed by
  route orchestration and does not copy production lifecycle or conflict
  logic.
- The duplicated `runStatusForTest`, `runTimestampsForTest`, and terminal-run
  merge behavior are removed from the route fake.

PGlite does not ship in the API runtime or replace production PostgreSQL. It
exists only to execute the real Drizzle store in tests.

### 2. Parent synthesis is lifecycle-neutral

For an event with `parent_source_run_id`, the synthetic parent keeps the
required shared identity and privacy fields but overrides:

- `source_run_id` with the parent's source run ID;
- synthetic source/event IDs with their existing `:parent` form;
- `type` with `run.updated`;
- `status` with `unknown`.

`run.updated` plus `unknown` produces neither a started nor a completed
timestamp. The existing `excluded.status = 'unknown'` conflict rule then
preserves the status of an existing parent.

The resulting behavior is:

- an unseen parent is created as `unknown`;
- a running or waiting parent keeps its lifecycle;
- a terminal parent keeps its lifecycle;
- the child is stored from its original event without modification;
- the parent-child relation is still inserted idempotently.

The fix remains at parent synthesis. It does not weaken terminal event
handling for genuine run events and does not add another lifecycle model.

### 3. Hosted database configuration fails closed

- `DATABASE_URL` is part of the parsed API environment.
- It remains optional locally so the existing local PostgreSQL fallback keeps
  working for development and tests.
- It is required when the existing `isHostedRuntime` predicate is true.
- Any provided value must be a valid URL using the `postgres:` or
  `postgresql:` protocol.
- `createApp` passes the parsed value explicitly to `createPool`; the pool does
  not reread a different unvalidated value from `process.env`.
- Missing or invalid hosted configuration throws during environment parsing,
  before the API begins listening.
- Error output identifies `DATABASE_URL` as invalid or required without
  printing credentials.

S6 does not add a database connectivity probe to `/health`. Detecting a
missing or malformed required setting is the accepted finding-21 boundary;
dependency readiness is a separate operational decision.

## Data and control flow

### Ingest

`runner batch → ingest route → ingestBatch → production DrizzleIngestStore → transaction → canonical PostgreSQL tables`

For a child event:

1. ensure workspace and device;
2. insert the batch idempotently;
3. upsert project and child run from the original event;
4. upsert a neutral parent reference when requested;
5. insert the parent-child relation;
6. insert the immutable source event;
7. record accepted and duplicate counts;
8. commit or roll back the transaction.

The PGlite contract tests follow this same store and transaction path.

### API startup

`process.env → parseApiEnv → validated DATABASE_URL → createPool → createDb → routes → listen`

Hosted parsing failure stops this flow before pool construction and before the
server can report healthy.

## Verification

### Production-store contract regressions

1. A new batch persists its workspace, device, project, run, event, and batch
   counts through the production store.
2. Replaying the same batch reports a duplicate batch without duplicating
   events.
3. Reusing an event in a different batch counts the event as duplicate.
4. A started run completed by a later event receives the terminal status and
   timestamp.
5. Newer activity can reopen a completed turn, while an older waiting event
   cannot reopen a terminal run.
6. A cancelled run update closes the run.
7. A technical event without run status preserves the existing run status.
8. A completed child referencing a running parent leaves the parent running
   with no completed timestamp, completes the child, and persists exactly one
   parent relation.

### Environment regressions

1. Local parsing without `DATABASE_URL` remains valid.
2. Hosted parsing without `DATABASE_URL` fails with a targeted error.
3. Hosted parsing rejects malformed and non-PostgreSQL URLs.
4. Hosted parsing accepts a valid PostgreSQL URL.
5. Application database construction receives the parsed URL rather than
   implicitly rereading the environment.

### Required gates

- focused production-store and environment tests;
- `pnpm --filter @alfred/api test`;
- `pnpm --filter @alfred/api typecheck`;
- `pnpm --filter @alfred/api build`;
- full `pnpm verify`;
- focused review of ingest persistence, environment validation, dependency
  scope, and removal of copied test logic.

### Runtime observation

Build the API and start it once with hosted-runtime flags, a non-secret
fixture runner token, and no `DATABASE_URL`.

The process must exit before listening, identify the missing database setting,
and avoid printing credentials. No real runner, production database, or
`~/.codex` data is used.

## Non-goals

- no desktop UI or Electron behavior changes;
- no production schema or migration changes;
- no browser client, OIDC, cookie auth, or retired query routes;
- no replacement of runner device-token auth;
- no database availability probe in `/health`;
- no Docker or external PostgreSQL requirement for tests;
- no generalized repository or persistence abstraction.

## Acceptance criteria

S6 is complete when:

1. the production Drizzle ingest store is exercised by PGlite-backed contract
   tests using the canonical migrations;
2. copied lifecycle and conflict logic no longer determines those tests;
3. a child terminal event cannot change its parent's lifecycle or timestamps;
4. hosted startup rejects missing, malformed, and non-PostgreSQL
   `DATABASE_URL` values before listening;
5. local database defaults remain available;
6. targeted tests, API typecheck/build, full verification, failure-path
   observation, and focused review all pass;
7. the parent roadmap records the implementation evidence and routes next to
   S7 without reopening S1–S5.
