# Alfred Agent Space Readiness Audit

Date: 2026-05-06
Branch: `repo-readiness-cleanup`
Scope: repository readiness before adding `apps/desktop` and Alfred Agent Space implementation.

## Summary

The repository is healthy enough to extend, but it had several readiness gaps
that would become painful once Electron, embedded terminals, and shared runtime
packages are added.

This cleanup handles the low-risk issues immediately:

- remove empty placeholder schema modules;
- make `@alfred/db` participate in root test coverage;
- add a DB/schema enum parity test;
- strengthen adapter normalization tests against the ingest contract;
- remove stale public exports that were only internal implementation details;
- stop treating tracked specs and audits as ignored files.

Larger architecture work remains intentionally deferred to dedicated PRs.

## Audit Inputs

Read-only subagent audits covered:

- package and app boundaries;
- dead code and stale files;
- tests and verification coverage;
- dependency, workspace, and configuration hygiene.

Local checks included:

- `rg` scans for TODO/FIXME/legacy/mockup/dead markers;
- `git ls-files -ci --exclude-standard`;
- `pnpm dlx knip --reporter compact`;
- workspace/package manifest inspection;
- focused package tests and typechecks.

## Findings Fixed In This Cleanup

### Empty schema placeholders

`packages/schema/src/missions.ts` and `packages/schema/src/runs.ts` contained
only `export {};`, were not exported from `packages/schema/src/index.ts`, and
had no imports in `apps`, `packages`, `api`, or `scripts`.

Action: deleted both files.

### `@alfred/db` was skipped by root tests

`pnpm test` runs scripts tests and then `turbo run test`. Before this cleanup,
`@alfred/db` had no `test` script, so Turbo silently skipped it while still
reporting a green workspace test run.

Action: added `packages/db/test/schema-contract.test.ts` and a package `test`
script.

### DB and shared schema enums could drift

The Drizzle enums in `packages/db/src/schema.ts` duplicate the Zod enums in
`packages/schema/src/enums.ts`. Before this cleanup, there was no automated
parity test.

Action: added a `@alfred/db` contract test that compares:

- `agentSourceEnum` with `AgentSource`;
- `eventTypeEnum` with `EventType`;
- `privacyModeEnum` with `PrivacyMode`;
- `runStatusEnum` with `RunStatus`.

### Adapter tests did not validate the final ingest contract

`@alfred/adapters` tested deterministic IDs and basic field mapping, but did
not parse normalized events through `IngestEventSchema`.

Action: updated `packages/adapters/test/normalize.test.ts` so normalized output
is validated by `@alfred/schema`, including optional parent run and status
fields.

### Tracked docs were still ignored

`.gitignore` ignored all of `docs/`, while the new Agent Space spec is tracked.
That made specs/audits require force-add and caused `git ls-files -ci` to show a
tracked ignored file.

Action: replaced the broad `docs/` ignore with selective rules that allow
tracked audit and spec markdown files while keeping local plans, scratch notes,
and `.DS_Store` ignored.

### Public exports included internal-only helpers

`knip` found a few exported constants/functions that were only used inside their
own modules.

Action: removed public exports from:

- `STALE_RUN_AFTER_MS` and `OPS_SMOKE_PROJECT_KEY` in
  `apps/api/src/services/runs-query-service.ts`;
- `STALE_RUN_AFTER_MS` in `apps/web/src/lib/run-view-model.ts`;
- `escapeXml` in `scripts/lib/runner-service.mjs`.

Action: deleted unused `TRIAGE_TABS`, `groupRunViewModels`, and its dedicated
group type from `apps/web/src/lib/run-view-model.ts`.

## Findings Deferred

### Runner service is macOS-only

The current service layer is launchd-specific and uses macOS Library paths. That
is acceptable for today's runner, but it cannot be the cross-platform runtime
foundation for an Electron app.

Recommended follow-up: introduce a host-independent runtime/service interface
and keep launchd as a macOS adapter.

### File-dump ingestion is not the desktop session source

Codex and Claude adapters read local JSONL dumps from `~/.codex` and
`~/.claude`. Alfred Agent Space needs manual terminals and embedded agent
sessions to be first-class runtime sources, not only post-hoc file imports.

Recommended follow-up: define a `SessionEvent` or runtime event contract before
desktop launch work begins.

### Run/session vocabulary is drifting

The current backend is run-centric, while the future desktop product is
session-centric. Some web copy already calls runs "sessions".

Recommended follow-up: create a shared vocabulary contract before exposing
desktop terminal sessions beside ingested runs.

### Lifecycle status derivation is duplicated

Run lifecycle semantics are inferred in API ingest/query services and again in
the web view model.

Recommended follow-up: centralize status derivation in a shared package before
adding desktop session statuses.

### API client is web-proxy centric

`apps/web` assumes relative `/api/v1/*` and `/api/v1/system/status` paths. This
is fine for the web app, but not enough for Electron or a future mobile
companion.

Recommended follow-up: add a configurable API connector/client layer with
browser defaults.

### Vercel `api/` boundary is not a workspace package

The root `api/` folder is a Vercel handler boundary with its own minimal
`package.json`, but it is not part of `pnpm-workspace.yaml`.

Recommended follow-up: either formalize it as a non-workspace Vercel boundary
with preflight checks or make it a bounded workspace package.

### Generated API bundle has no preflight guard

`api/_handler.ts` imports `api/.generated/app.cjs`, which is produced by
`scripts/build-vercel-api.mjs`. Vercel build order handles this today, but local
direct imports fail if generation is skipped.

Recommended follow-up: add a clear preflight check or documented invariant for
the Vercel handler path.

### Dependency policy is too loose for desktop packaging

Many manifests use `latest`, and the lockfile contains multiple build-tool
versions. This is acceptable during early prototyping but risky for Electron
packaging and native dependency reproducibility.

Recommended follow-up: pin direct dependency ranges and run a controlled
dedupe/lockfile pass.

### Root Node version is not explicit

The repo has `packageManager` but no root `engines` policy. The Vercel bundle
targets Node 22 and native dependencies already assume a modern Node.

Recommended follow-up: add an explicit Node/pnpm engine policy after confirming
the deployment target.

### Web tests overfit implementation details

Some tests assert CSS classes and literal SVG transforms. They pass today, but
will make UI reuse/refactors noisier.

Recommended follow-up: shift toward roles, labels, and behavior assertions when
touching those files next.

### Residual static-analysis findings

After cleanup, `pnpm dlx knip --reporter compact` still reports:

- Vercel route entry files under `api/` as unused. These are framework
  entrypoints, not dead code.
- Manual scripts such as `scripts/build-vercel-api.mjs`, `scripts/dev-doctor.mjs`,
  and `scripts/purge-old-runs.mjs` as unused. These are invoked by Vercel,
  README workflows, or direct maintenance commands.
- Some exported types that are part of local module contracts but are not
  imported by name today.
- `drizzle-kit` in `packages/db/package.json` as unused. It may be removable,
  but should be handled in a dedicated dependency policy pass.

Recommended follow-up: add a checked-in `knip` configuration only after deciding
which framework entrypoints, maintenance scripts, and type exports should be
treated as public contracts.

## Current Go/No-Go

Go for UI design and small shared-contract PRs.

No-go for immediate `apps/desktop` scaffolding until these are planned:

1. UI design spec and mockups.
2. Runtime/session event contract.
3. Status vocabulary contract for run vs session.
4. Desktop runtime boundary plan for PTY/process management.
