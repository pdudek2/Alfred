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

`Phase Z release closeout → post-v1 stabilization roadmap → Phase S1 desktop safety gate`

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
| S2 — Runner loss and stall prevention | Concurrent sessions do not lose events; poison or malformed records cannot stall sync | 6, 7, 8, 24 | Next |
| S3 — API boundary simplification | Delete browser-session auth and browser-only query surfaces; keep device-auth ingest | 9, 10, 22 | Pending |
| S4 — Privacy and worktree lifecycle | Resolve worktree close behavior and prevent sensitive launch data from persisting | 13, 15, 16 | Pending decision gates |
| S5 — Desktop interaction correctness | Recover failed planning, unblock review/edit, remove impure state updaters, correct activity classification | 5, 11, 17, 23 | Pending |
| S6 — Ingest/API correctness | Correct parent lifecycle, validate hosted DB config, and test the real ingest store | 12, 20, 21 | Pending |
| S7 — Residue and blocked-boundary review | Complete scripts/tooling and CSS/accessibility audits; triage investigate-only signals | audit gaps | Pending |

Only the current phase receives an implementation plan. A later phase starts
after the preceding phase has fresh verification and closeout.

## Finding ledger

| # | State | Route |
|---:|---|---|
| 1 | Fixed in `1fc9d2e` | Closed |
| 2 | Fixed in `6a6c1d7` | Closed |
| 3 | Fixed in `cf62ee4` | Closed |
| 4 | Fixed in `90a04e5` | Closed |
| 5 | Confirmed | S5 |
| 6 | Confirmed | S2 |
| 7 | Confirmed; cursor-key design required | S2 |
| 8 | Confirmed | S2 |
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
| 24 | Confirmed | S2 |

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

## Explicitly deferred

- A browser client or remote browser access.
- Replacing device-token runner auth.
- Deleting auth-related database tables before runtime code is removed and
  schema impact is measured.
- Broad refactors of `styles.css`, API services, persistence, or the runner
  while fixing a local root cause.
- New abstractions, feature flags, or compatibility shims for retired routes.
