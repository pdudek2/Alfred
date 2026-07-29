# Phase S3 — API Boundary Simplification

**Status:** Complete

**Date:** 2026-07-29

**Owner:** `main`

**Parent:** `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Findings:** 9, 10, 22

## Summary

Alfred is an Electron-only product. Its hosted API exists to receive runner
telemetry, not to authenticate people or serve a browser client.

S3 removes browser-session authentication, OIDC, development session cookies,
and the human query routes that depended on them. The surviving public boundary
is health plus device-authenticated runner ingest.

This resolves the affected findings by deleting the abandoned product surface
instead of repairing or migrating it.

## Problem

The API still exposes a complete browser-era authentication and query stack:

- `/auth/*` and `/api/auth/*` create OIDC or development-cookie sessions;
- `/v1/runs`, `/api/v1/runs`, `/v1/system/status`, and
  `/api/v1/system/status` expose transcript-bearing data through those sessions;
- scripts, smoke checks, environment variables, Vercel rewrites, and README
  instructions continue advertising that surface.

There is no supported browser client and the Electron renderer does not call
these routes. Keeping them creates authorization and maintenance obligations
for a product path that no longer exists.

> “Browser-session authentication and human query routes are retired rather
> than migrated to device auth.” — post-v1 stabilization roadmap

## Goals

- Remove every mounted OIDC, session-cookie, and development-cookie route.
- Remove browser-only run and system-status query routes and their unused
  backing services.
- Keep runner heartbeat and batch ingest behavior unchanged under Bearer
  device-token authentication.
- Remove browser-auth configuration, rewrites, smoke modes, diagnostics, tests,
  and documentation that would imply the deleted surface still exists.
- Preserve bootstrap creation of the user, workspace, and device required by
  runner ingest.
- Make retired direct and `/api` alias routes return the normal Hono `404`
  response with no redirect, compatibility shim, or replacement auth path.

## Non-goals

- No browser client or remote browser access.
- No new human-facing API and no migration of query routes to device auth.
- No change to the ingest schemas, runner token format, hashing, workspace
  scoping, idempotency, or hosted ingest storage.
- No removal of `sessions` or `oidc_identities` tables, Drizzle schema entries,
  migrations, or existing rows in S3.
- No general API service refactor and no renaming of the local development
  device-auth flag.
- No desktop UI or visual changes.
- No deployment, hosted environment mutation, or production data mutation
  without separate authorization.

## User stories

- As an Alfred user, I want the cloud API to expose only the functionality the
  Electron product actually uses so abandoned browser paths cannot expose my
  agent activity.
- As an operator, I want runner ingest and heartbeat to keep working with the
  same device token before and after S3.
- As a developer, I want local setup, smoke checks, and diagnostics to describe
  the surviving API truthfully without session-cookie workarounds.

## Behavior contract

### Surviving HTTP surface

| Route | Authentication | Contract |
|---|---|---|
| `GET /health` | public | unchanged liveness response |
| `GET /api/health` | public | unchanged Vercel alias |
| `POST /v1/ingest/heartbeat` | Bearer device token | unchanged `202` behavior |
| `POST /v1/ingest/batches` | Bearer device token | unchanged validation and `202` behavior |
| `POST /api/v1/ingest/heartbeat` | Bearer device token | unchanged alias |
| `POST /api/v1/ingest/batches` | Bearer device token | unchanged alias |

Missing or invalid device tokens continue returning `401`. A valid token with a
workspace or device mismatch continues returning `403`. S3 does not introduce a
second authentication mechanism.

The root metadata response remains public and advertises health plus the two
canonical `/v1/ingest/*` routes. It no longer advertises runs or auth.

### Retired HTTP surface

The following paths are no longer mounted and return the default `404`:

- `/auth/login`, `/auth/callback`, `/auth/logout`;
- `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`;
- `/v1/runs`, `/v1/runs/:runId`, `/api/v1/runs`,
  `/api/v1/runs/:runId`;
- `/v1/system/status`, `/api/v1/system/status`.

There is no `410` tombstone, redirect, deprecation handler, feature flag, or
session-to-device compatibility layer.

### Runtime deletion boundary

Delete production modules whose only purpose is the retired surface:

- `apps/api/src/routes/auth.ts`;
- `apps/api/src/auth/oidc-auth.ts`;
- `apps/api/src/auth/session-auth.ts`;
- `apps/api/src/auth/cookies.ts`;
- `apps/api/src/routes/runs.ts`;
- `apps/api/src/routes/system.ts`;
- `apps/api/src/services/runs-query-service.ts`;
- `apps/api/src/services/runner-status-service.ts`;
- `apps/api/src/services/system-status-store.ts`.

Delete or rewrite their tests. Keep:

- `apps/api/src/auth/device-auth.ts`;
- `apps/api/src/auth/token-hash.ts`;
- `apps/api/src/auth/bootstrap-auth.ts`;
- `apps/api/src/routes/ingest.ts`;
- `apps/api/src/services/ingest-service.ts`.

`createApp()` mounts only health and ingest beneath the direct and `/api`
aliases. The bootstrap gate remains because the runner's user, workspace, and
device rows are still required.

### Configuration boundary

Remove these browser-only runtime inputs from the API environment schema and
documentation:

- `AUTH_OIDC_ISSUER`;
- `AUTH_OIDC_CLIENT_ID`;
- `AUTH_OIDC_CLIENT_SECRET`;
- `AUTH_DEV_SESSION_TOKEN`;
- `APP_BASE_URL`.

Keep `ALFRED_ALLOW_DEV_AUTH` / `DEV_AUTH_ENABLED` only for the existing local
static device-token fallback and default runner token. Hosted runtime must
continue rejecting the built-in default runner device token.

Stale browser-auth variables may remain temporarily in a deployment
environment, but the new runtime does not read them.

### Tooling and documentation boundary

- `scripts/cloud-smoke.mjs` supports only `public` boundary and `runner-auth`
  ingest modes. Public mode verifies health plus `404` responses from the
  retired direct and alias routes. Remove `authenticated`,
  `ALFRED_EXPECT_AUTH`, session cookies, and auth-route validation.
- `scripts/dev-doctor.mjs` stops calling `/api/v1/system/status` with a session
  cookie. It keeps process-level runner checks and points service users to
  `runner:service:doctor` / logs rather than creating a replacement query API.
- `scripts/dev-alfred.mjs` may keep `ALFRED_ALLOW_DEV_AUTH=1` because the
  fixture runner still needs the local static device token.
- Remove the `/auth/:path*` Vercel rewrite. Keep `/api`, `/v1`, and `/health`
  rewrites for the surviving API.
- Remove route-specific tasks from `scripts/launch-parallel-agents.mjs` that
  would recreate `/v1/runs` or its alias.
- Rewrite README and `.env.example` so local API setup documents health and
  device-auth ingest only.

### Database boundary

S3 performs no database migration.

Existing `sessions` and `oidc_identities` tables and rows remain inert because
the runtime has no route that creates, reads, refreshes, or revokes them. Their
eventual schema cleanup remains deferred until runtime removal is verified and
migration impact is measured.

## Success criteria

| Measure | Target | Evidence |
|---|---:|---|
| Browser auth routes | all direct and alias paths return `404` | app boundary regression |
| Human query routes | runs and system direct/alias paths return `404` | app boundary regression |
| Device-auth heartbeat | valid token accepted, missing/invalid token rejected | ingest regression |
| Device-auth batch ingest | existing `202`, scope, and validation behavior unchanged | ingest regression |
| Browser-auth production modules | zero runtime imports or mounted routes | focused static review |
| Browser-auth environment inputs | zero runtime reads and no README/env-example contract | env and documentation tests |
| Cloud smoke | public boundary and runner-auth modes pass; authenticated mode absent | script regressions |
| Vercel boundary | no auth rewrite; API remains API-only | product-boundary regression |
| Hosted database | no schema or migration diff | Git diff review |
| API package | tests, typecheck, and build pass | package gates |
| Repository | `pnpm verify` passes | phase gate |

## Scope milestones

| Milestone | Outcome | Exit gate |
|---|---|---|
| S3.1 — Runtime boundary | auth, runs, and system routes/services removed; ingest preserved | API regressions |
| S3.2 — Config and tooling | browser-auth env, smoke, doctor, rewrites, and stale agent prompts removed | script and boundary tests |
| S3.3 — Documentation and verification | README/env contract updated and repository gates green | `pnpm verify` |
| S3.4 — Rollout observation | deployed API exposes health and device ingest only | authorized hosted smoke |

## Rollout and recovery

1. Ship runtime deletion without a database migration.
2. Keep hosted OIDC/session environment variables during the first verification
   window; the new runtime ignores them.
3. Verify health and runner-auth heartbeat/batch ingest.
4. Verify every retired direct and alias route returns `404`.
5. Remove stale hosted browser-auth variables only after the new deployment is
   accepted.

Rollback restores the previous binary. Because auth tables and migrations stay
intact, no database rollback is needed. If hosted browser-auth variables were
already removed, restore them before rolling back to the previous binary.

## Local verification checkpoint

Local verification completed on 2026-07-29. Hosted deployment and smoke were
not authorized, so S3 remains pending `pnpm smoke:cloud` and
`pnpm smoke:cloud:runner` against separately supplied hosted credentials.

- `pnpm --filter @alfred/api test` — 3 files, 41/41 tests passed.
- `pnpm --filter @alfred/api typecheck` and `pnpm --filter @alfred/api build`
  — passed.
- `pnpm test:scripts` — 34/34 tests passed.
- `pnpm verify` — lint, 9 typecheck tasks, 34 script tests, 1,083 package
  tests, 6 build tasks, and 16/16 Electron smoke tests passed.
- The runtime residue scans found 0 matches after excluding
  `apps/api/src/test/**`; the original `!test/**` glob did not exclude that
  path and reported the five intentionally retained retired-config fixtures
  in `apps/api/src/test/env.test.ts` twice (10 matching lines).
- Diff review found no desktop UI, schema/migration, dependency, query-route
  replacement, route redirect/tombstone, or compatibility-flag change.

The final local integration added a direct `GET /api/health` regression,
bringing the API suite to 42/42. `main` was fast-forwarded through `4649718`,
then fresh `pnpm test`, `pnpm typecheck`, and `pnpm build` gates passed.

## Hosted verification closeout

Production deployment `dpl_5PZsSKKJ9UgJ1q47bSe8uXYTWWpQ` reached `READY` on
2026-07-29. Smoke checks used its public production alias
`https://alfred-jade-ten.vercel.app`:

- public health returned `200`;
- every retired direct and `/api` alias route returned `404`;
- runner heartbeat returned `202`;
- a synthetic runner batch returned `202`.

The deployment-specific URL is protected by Vercel SSO and returns `302`, so
it is not the public observation surface. The unused production
`APP_BASE_URL` variable remains in place: Vercel exposes it as encrypted but
does not return a recoverable value through `env pull`, so deleting it would
weaken rollback of the previous binary without changing the current runtime.

## Acceptance gate

- Add negative route tests for every retired direct and alias route.
- Preserve positive and negative device-auth ingest tests.
- Add script tests proving cloud smoke has no authenticated/session-cookie mode.
- Update product-boundary tests for the Vercel rewrites and documentation.
- Run `pnpm --filter @alfred/api test`, typecheck, and build.
- Run `pnpm test:scripts`.
- Run `pnpm verify`.
- Perform a focused security review proving there is no browser-session
  middleware, OIDC callback, cookie consumer, browser query route, or payload
  exposure left in the runtime.
- Perform an authorized hosted smoke before phase closeout; if deployment is
  not authorized, leave that gate explicitly pending.
- No visual observation is required because S3 changes no Electron UI.

## Open questions

None block S3. Auth-table deletion and removal of the unused hosted
`APP_BASE_URL` variable remain explicitly deferred.
