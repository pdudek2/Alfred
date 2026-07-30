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

`Phase Z release closeout → post-v1 stabilization roadmap → S1 complete → S2 complete → S3 complete → S4 complete → S5 complete → S6 next`

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
- S4 product decisions are settled: live isolated Close retains Recovery,
  Discard remains explicitly destructive, and retention Off/Clear remove
  sensitive launch data while preserving only safe worktree-recovery identity.
- S4 implementation and final review follow-up are complete at `4885ff1`.
- S5 implementation is complete at `628b7c8`; rejected planning recovers,
  blocked staged agents are editable, S5-owned state updaters are pure, and
  file activity uses complete-word alternatives.

## Phases

| Phase | Outcome | Findings | State |
|---|---|---:|---|
| S1 — Desktop safety gate | Honest runtime gate and no silent desktop-state loss | 2, 3, 4, 14, 19 | Complete |
| S2 — Runner loss and stall prevention | Concurrent sessions do not lose events; poison or malformed records cannot stall sync | 6, 7, 8, 24 | Complete |
| S3 — API boundary simplification | Delete browser-session auth and browser-only query surfaces; keep device-auth ingest | 9, 10, 22 | Complete |
| S4 — Privacy and worktree lifecycle | Resolve worktree close behavior and prevent sensitive launch data from persisting | 13, 15, 16 | Complete |
| S5 — Desktop interaction correctness | Recover failed planning, unblock review/edit, remove impure state updaters, correct activity classification | 5, 11, 17, 23 | Complete |
| S6 — Ingest/API correctness | Correct parent lifecycle, validate hosted DB config, and test the real ingest store | 12, 20, 21 | Pending |
| S7 — Residue and blocked-boundary review | Complete scripts/tooling and CSS/accessibility audits; triage investigate-only signals | audit gaps | Pending |

Only an actively converged phase receives an implementation plan. S6 remains
unplanned until a new convergence workflow begins.

**Closed phase contract:** `docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification.md`

**Closed implementation plan:** `docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification-implementation-plan.md`

**Closed phase:** S4 — Privacy and worktree lifecycle.

**Historical S4 handoff:** S5 — Desktop interaction correctness, since
completed.

**Closed phase contract:** `docs/superpowers/specs/2026-07-29-phase-s4-privacy-worktree-lifecycle.md`

**Closed implementation plan:** `docs/superpowers/plans/2026-07-29-phase-s4-privacy-worktree-lifecycle.md`

**Closed phase contract:** `docs/superpowers/specs/2026-07-30-phase-s5-desktop-interaction-correctness-design.md`

**Closed implementation plan:** `docs/superpowers/plans/2026-07-30-phase-s5-desktop-interaction-correctness.md`

**Closed phase:** S5 — Desktop interaction correctness.

**Next phase:** S6 — Ingest/API correctness; findings 12, 20, and 21,
unplanned until a new convergence workflow begins.

The roadmap product-boundary decision above remains unchanged: delete browser-session
auth and browser-only query surfaces while retaining device-auth ingest.

## Finding ledger

| # | State | Route |
|---:|---|---|
| 1 | Fixed in `1fc9d2e` | Closed |
| 2 | Fixed in `6a6c1d7` | Closed |
| 3 | Fixed in `cf62ee4` | Closed |
| 4 | Fixed in `90a04e5` | Closed |
| 5 | Fixed in `ef768cc` | Closed |
| 6 | Fixed in `c9130e7`, `8b12fbe`, `4b17a14` | Closed |
| 7 | Fixed in `50fc5c0` | Closed |
| 8 | Fixed in `4b4bd33`, `720e783`, `7eb31fb`, `4b17a14` | Closed |
| 9 | Superseded by product-boundary decision | S3 deletes the session surface |
| 10 | Superseded by product-boundary decision | S3 deletes the OIDC surface |
| 11 | Fixed in `478ae96` | Closed |
| 12 | Confirmed | S6 |
| 13 | Fixed in `b192291`, `aad5063`, `fa7cf19`, `d5556eb`, `2a29706`, `54067ff`, `4885ff1` | Closed |
| 14 | Fixed in `90a04e5` | Closed |
| 15 | Fixed in `591c865`, `66329fb`, `006385e`, `1b13861`, `f73ae07`, `279d9af`, `fa7cf19`, `d5556eb`, `54067ff`, `4885ff1` | Closed |
| 16 | Fixed in `47ce4fa`, `4885ff1` | Closed |
| 17 | Fixed in `3da82ed`, `5b98464`, `d8283d2` | Closed |
| 18 | Fixed in `2a020a0` | Closed |
| 19 | Fixed in `5ae7c1d` | Closed |
| 20 | Confirmed | S6 |
| 21 | Confirmed | S6 |
| 22 | Superseded by product-boundary decision | S3 deletes dev cookie auth |
| 23 | Fixed in `628b7c8` | Closed |
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

## S3 closeout

**State:** Complete
**Implementation commits:** `8f6b5cd`, `c4042d5`, `16cb30d`, `a136be9`, `e1521aa`, `a96d8c9`, `4649718`
**Next phase:** S4 — Privacy and worktree lifecycle

Local gates passed: API 42/42 tests, API typecheck and build, script tests
34/34, and the pre-integration `pnpm verify` gate (lint, typecheck, tests,
build, and Electron smoke 16/16). After the fast-forward integration into
`main`, fresh `pnpm test`, `pnpm typecheck`, and `pnpm build` gates passed.
Runtime residue scans returned 0 matches after the test-path exclusion was
corrected to match `apps/api/src/test/**`; no runtime residue remains.

Focused diff review found no desktop UI, schema/migration, dependency,
query-route replacement, route redirect/tombstone, or compatibility-flag
change. Production deployment `dpl_5PZsSKKJ9UgJ1q47bSe8uXYTWWpQ` reached
`READY`; public smoke verified health `200` and every retired route `404`,
while runner-auth smoke verified heartbeat and synthetic batch `202`.

## S4 closeout

**State:** Complete

**Implementation commits:** `47ce4fa`, `591c865`, `66329fb`, `006385e`,
`1b13861`, `f73ae07`, `279d9af`, `b192291`, `aad5063`, `fa7cf19`, `d5556eb`,
`676cb15`, `2a29706`, `54067ff`, `4885ff1`

**Next phase:** S5 — Desktop interaction correctness; unplanned until a new
convergence workflow begins

Closed behavior:

- live isolated Close retains privacy-safe Recovery metadata and never deletes
  the checkout;
- Review, Apply, and explicit permanent Discard survive restart and canonical
  macOS filesystem aliases;
- Discard validates the workspace identity and managed root, awaits cleanup,
  and forgets metadata only after cleanup succeeds;
- retention Off and Clear remove launch, resume, raw-path, transcript, and
  activity fields while retaining only safe worktree identity;
- the single persisted-session sanitizer handles migration, privacy changes,
  live-session races, and retry writes;
- the shared redactor covers URI userinfo, accepted provider-token prefixes,
  JSON secret assignments, and complete Cookie values.

Fresh verification at `54067ff` passed schema 47/47 tests, desktop 962/962
tests, package typechecks and builds, full `pnpm test` with 34/34 root script
tests and all six package test tasks (1,174 tests total), full typecheck 9/9,
full build 6/6, and `pnpm verify` including Electron smoke 16/16.

Final review follow-up at `4885ff1` closed the remaining hydration,
cleanup-before-forget, stale Discard preflight, complete Cookie redaction, and
secret-safe diagnostic gaps. Fresh focused verification passed schema 43/43
and desktop 330/330 tests. Full `pnpm verify` passed 1,187/1,187 automated
tests, typecheck 9/9, build 6/6, and Electron smoke 16/16. The independent
scoped re-review reported 0 Critical, 0 Important, and 0 Minor findings and
approved the fix wave.

A complete disposable macOS observation independently exercised Apply,
recreate plus permanent Discard, and recovery under retention Off. The actual
Off recovery record contained safe identity only; none of `cwd`, `baseCwd`,
`shell`, `command`, `args`, `resumeTarget`, `buffer`, `activityEvents`,
`lastActivityAt`, or `lastOutputAt` remained. Review still reported both the
tracked and untracked changes. Final external Git checks confirmed the recovery
record, managed worktree, and branch were removed while the base repository
remained clean.

Focused review found no API, database, runner, dependency, lockfile, migration,
or broad visual change; no duplicate sanitizer; cleanup-before-forget ordering;
and no route for an already-live session to repersist cleared launch data.
At S4 closeout, finding 17 remained routed to S5 except for the single
destructive updater path required for transactional Discard. S5 has since
closed the remaining finding-17 scope.

## S5 closeout

**State:** Complete

**Implementation commits:** `ef768cc`, `478ae96`, `3da82ed`, `5b98464`,
`d8283d2`, `628b7c8`

**Next phase:** S6 — Ingest/API correctness; findings 12, 20, and 21

Closed behavior:

- planning and preflight exceptions now become safe structured failures, the
  renderer independently handles a rejected preload promise, and retry remains
  available;
- blocked staged Codex, Claude, shell, and dev-server work uses the existing
  Review / Edit surface, with authoritative safety and preflight returned by
  the main process;
- the S5-owned workspace, session, and plan state updaters are effect-free,
  with IDs, timestamps, persistence, IPC, and sibling state updates outside
  replayable callbacks;
- file activity recognizes complete operation words without false positives
  from `unmodified`, `overwritten`, or `rewritten`.

Fresh verification passed the requested desktop test command; because the
package forwarded the literal `--`, Vitest ran the full desktop suite (62/62
files and 992/992 tests). Desktop typecheck, desktop build, and full
`pnpm verify` also passed, including lint, typecheck 9/9, package and root
tests, build 6/6, and Electron smoke 16/16. Focused review of the accepted
production and regression-test diff reported 0 Critical, 0 Important, and 0
Minor findings.

Direct Electron observation used an isolated copied build, temporary
`userData`, and temporary Codex and Claude homes. A forced IPC rejection
rendered retryable copy with the composer enabled; retry produced staged
Codex work; a safe edit became ready and launchable; and a second edit
remained blocked with the refreshed workspace-mismatch reason and disabled
Launch action. The real runner and `~/.codex` were not used.

Final screenshot:
`.superpowers/sdd/2026-07-30-phase-s5-desktop-interaction-correctness/task-6-evidence/runtime.fujkF4/final-blocked-state.png`

Visual evidence: Observed — surface: Computer Use; proof: the completed final
`sky.get_app_state` showed the blocked workspace-mismatch state,
`edited · rechecked`, external cwd `/tmp/alfred-s5-outside-workspace`,
`Safety review required`, and the disabled `Blocked` launch action;
`nodeRepl.emitImage` then emitted the screenshot at the path above.

## Explicitly deferred

- A browser client or remote browser access.
- Replacing device-token runner auth.
- Deleting auth-related database tables before runtime code is removed and
  schema impact is measured.
- Removing the unused encrypted production `APP_BASE_URL` variable before its
  rollback value is recoverable.
- Broad refactors of `styles.css`, API services, persistence, or the runner
  while fixing a local root cause.
- New abstractions, feature flags, or compatibility shims for retired routes.
- Normalizing a transport-level preload invocation rejection into the retained
  tile warning is routed to S7 final branch triage; S5 remains complete.
- Reconciling the desktop store's internal failed-save retry intent after a
  post-cleanup flush rollback is routed to S7 residue and blocked-boundary
  review; cleanup has already succeeded and the prior disk record remains.
- Using an explicit Windows directory junction in filesystem-alias regression
  coverage is routed to S7 tooling residue.
