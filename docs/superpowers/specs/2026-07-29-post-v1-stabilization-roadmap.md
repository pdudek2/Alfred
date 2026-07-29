# Alfred Post‑v1 Stabilization Roadmap

**Status:** Active  
**Owner:** `main`  
**Baseline:** `2a020a0`  
**Source audit:** `docs/audits/2026-07-29-agent-sanity-review.md`

## Objective

Turn the first usable Alfred release into a trustworthy daily-use build by
closing verified data-loss, availability, privacy, and correctness defects
without reopening the accepted product or visual direction.

## Product boundary

- Electron remains the only user client.
- There is no supported browser UI.
- The local runner may continue to send data to the Hono API.
- Runner ingest keeps Bearer device-token authentication.
- Browser-session authentication (OIDC, cookies, `/auth/*`) is retired.
- Human query routes that exist only for the removed browser client are retired
  rather than exposed without authentication or migrated to device auth.
- Authentication database tables are not removed in the same phase unless
  runtime removal proves that a schema migration is necessary.

## Routing

- **Decision:** settled.
- **Diagnosis:** known cause; the audit findings were traced to current code.
- **Execution:** Large/phased.
- **Risk:** Elevated because the roadmap includes persistence, privacy, and
  authentication boundaries.
- **Simplicity posture:** Lean. Delete unused surfaces, reuse current stores and
  tests, and avoid compatibility layers for the removed browser client.

## Scope lineage

`Phase Z release closeout → post-v1 stabilization roadmap → S1 complete → S2 complete → S3 implementation plan approved`

Phase Z remains closed. This roadmap does not reinterpret or reopen its visual
or product decisions.

## Current evidence

- Finding 1 was fixed by `1fc9d2e`: the offline Preview expectation now stubs
  `fetch`.
- Finding 18 was fixed by `2a020a0`: missing workspace folders are recoverable.
- Findings 2, 3, 4, 14, and 19 were fixed and regression-tested in S1.
- Runner ingest still uses Bearer device auth independently of OIDC/cookies.
- OIDC/cookie auth and its only consumers are API routes, cloud-smoke/dev-doctor
  helpers, tests, environment variables, and README documentation. The Electron
  renderer does not call them.

## Phases

| Phase | Outcome | Findings | State |
|---|---|---:|---|
| S1 — Desktop safety gate | Honest runtime gate and no silent desktop-state loss | 2, 3, 4, 14, 19 | Complete |
| S2 — Runner loss and stall prevention | Concurrent sessions do not lose events; poison or malformed records cannot stall sync | 6, 7, 8, 24 | Complete |
| S3 — API boundary simplification | Delete browser-session auth and browser-only query surfaces; keep device-auth ingest | 9, 10, 22 | Local gate complete — hosted smoke pending |
| S4 — Privacy and worktree lifecycle | Resolve worktree close behavior and prevent sensitive launch data from persisting | 13, 15, 16 | Pending decision gates |
| S5 — Desktop interaction correctness | Recover failed planning, unblock review/edit, remove impure state updaters, correct activity classification | 5, 11, 17, 23 | Pending |
| S6 — Ingest/API correctness | Correct parent lifecycle, validate hosted DB config, and test the real ingest store | 12, 20, 21 | Pending |
| S7 — Residue and blocked-boundary review | Complete scripts/tooling and CSS/accessibility audits; triage investigate-only signals | audit gaps | Pending |

Only the current phase receives an implementation plan. A later phase starts
after the preceding phase has fresh verification and closeout.

**Closed phase contract:** `docs/superpowers/specs/2026-07-29-phase-s2-runner-loss-stall-prevention.md`

**Closed implementation plan:** `docs/superpowers/specs/2026-07-29-phase-s2-runner-loss-stall-prevention-implementation-plan.md`

**Current phase contract:** `docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification.md`

**Approved implementation plan:** `docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification-implementation-plan.md`

Its product-boundary decision above remains unchanged: delete browser-session
auth and browser-only query surfaces while retaining device-auth ingest.

## Finding ledger

| # | State | Route |
|---:|---|---|
| 1 | Fixed in `1fc9d2e` | Closed |
| 2 | Fixed in `6a6c1d7` | Closed |
| 3 | Fixed in `cf62ee4` | Closed |
| 4 | Fixed in `90a04e5` | Closed |
| 5 | Confirmed | S5 |
| 6 | Fixed in `c9130e7`, `8b12fbe`, `4b17a14` | Closed |
| 7 | Fixed in `50fc5c0` | Closed |
| 8 | Fixed in `4b4bd33`, `720e783`, `7eb31fb`, `4b17a14` | Closed |
| 9 | Superseded by product-boundary decision | S3 deletes the session surface |
| 10 | Superseded by product-boundary decision | S3 deletes the OIDC surface |
| 11 | Confirmed | S5 |
| 12 | Confirmed | S6 |
| 13 | Confirmed; close semantics unresolved | S4 decision gate |
| 14 | Fixed in `90a04e5` | Closed |
| 15 | Confirmed; restore-fidelity tradeoff unresolved | S4 decision gate |
| 16 | Confirmed | S4 |
| 17 | Confirmed | S5 |
| 18 | Fixed in `2a020a0` | Closed |
| 19 | Fixed in `5ae7c1d` | Closed |
| 20 | Confirmed | S6 |
| 21 | Confirmed | S6 |
| 22 | Superseded by product-boundary decision | S3 deletes dev cookie auth |
| 23 | Confirmed | S5 |
| 24 | Fixed in `4b4bd33`, `720e783`, `7eb31fb`, `4b17a14` | Closed |

## Phase gates

Every phase requires:

1. targeted regression tests for each accepted finding;
2. fresh typecheck and build for touched packages;
3. the narrow runtime or failure-path observation appropriate to the change;
4. `pnpm verify` before closeout;
5. a focused review of the changed boundary;
6. an explicit closeout update in this roadmap.

## S1 closeout

**State:** Complete  
**Implementation commits:** `6a6c1d7`, `cf62ee4`, `90a04e5`, `5ae7c1d`  
**Next phase:** S2 — Runner loss and stall prevention

Closed behavior:

- terminal-grid wheel handoff uses a native non-passive listener and remains
  cancelable at the xterm scroll boundary;
- quit-time terminal persistence hydrates disk snapshots before flushing and
  preserves any local mutations made while hydration starts;
- corrupt or unsupported desktop state is quarantined before defaults are
  returned, and quarantine failures stop the unsafe fallback;
- persistence warnings reach the main-process log;
- a failed desktop-state mutation remains the base of the next update.

Fresh verification:

- `pnpm --filter @alfred/desktop test` — 922/922 passed;
- `pnpm --filter @alfred/desktop typecheck` — passed;
- `pnpm --filter @alfred/desktop build` — passed;
- `pnpm smoke:electron` — 16/16 passed;
- `pnpm verify` — lint, typecheck, tests, build, and Electron smoke passed.

Focused review found no unrelated visual, API, schema, dependency, or persisted
format changes.

## S2 closeout

**State:** Complete
**Implementation commits:** `c9130e7`, `50fc5c0`, `4b4bd33`, `720e783`, `7eb31fb`, `8b12fbe`, `4b17a14`
**Next phase:** S3 — API boundary simplification

Closed behavior:

- malformed source records are skipped with payload-free diagnostics while
  healthy records and adapters continue;
- each source session file has a stable composite cursor, persisted only after
  its collected events are enqueued;
- invalid, identity-mismatched, and permanently rejected queued events move
  transactionally to the local SQLite quarantine without losing their payload;
- only HTTP `400`, `413`, and `422` decompose a rejected batch, while network,
  authentication, rate-limit, and server failures remain retryable;
- queued data still flushes before an adapter collection failure is surfaced.
- simultaneous collection and delivery failures preserve both errors while the
  retryable event remains queued.

Fresh verification:

- `pnpm --filter @alfred/runner test` — 86/86 passed; tests create temporary
  Codex/Claude homes and temporary SQLite outboxes, with no real user homes;
- `pnpm --filter @alfred/runner typecheck` — passed;
- `pnpm --filter @alfred/runner build` — passed;
- `pnpm verify` — lint, typecheck, tests, build, and Electron smoke passed.

Focused review verified stable per-session cursor keys, enqueue-before-cursor
ordering, transactional exact-payload quarantine, harmless ignored global
cursors, the restricted permanent-rejection classification, payload-free
warnings, and no API, hosted schema, device-auth, desktop, or visual change.

## S3 local checkpoint

**State:** Local gate complete — hosted smoke pending
**Implementation commits:** `8f6b5cd`, `c4042d5`, `16cb30d`, `a136be9`, `e1521aa`
**Next phase:** S4 remains unstarted pending S3 hosted smoke

Local gates passed: API 41/41 tests, API typecheck and build, script tests
34/34, and `pnpm verify` (lint, typecheck, tests, build, and Electron smoke
16/16). Runtime residue scans returned 0 matches after the test-path exclusion
was corrected to match `apps/api/src/test/**`; no runtime residue remains.

Focused diff review found no desktop UI, schema/migration, dependency,
query-route replacement, route redirect/tombstone, or compatibility-flag
change. No hosted deployment or smoke was authorized or run.

## Explicitly deferred

- A browser client or remote browser access.
- Replacing device-token runner auth.
- Deleting auth-related database tables before runtime code is removed and
  schema impact is measured.
- Broad refactors of `styles.css`, API services, persistence, or the runner
  while fixing a local root cause.
- New abstractions, feature flags, or compatibility shims for retired routes.
