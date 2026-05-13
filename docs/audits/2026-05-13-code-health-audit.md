# Code Health Audit — 2026-05-13

## Scope

Deep dive after the desktop review-hierarchy pass. The audit focused on repository hygiene, local worktrees/branches, AI-slop patterns, dead or fragile code, test flakiness, hardcoding, hidden runtime dependencies, and duplicate implementation logic.

## Repository Hygiene

- Pruned stale git worktree metadata.
- Removed merged local worktree branches that no longer had active worktrees.
- Preserved the active Alfred agent worktree branch.
- Previous UI hierarchy work was committed and pushed to `origin/main` as `1d75abe Refine desktop review hierarchy`.
- Follow-up code-health work is isolated on `code-health-audit`.

## Findings Fixed

### OIDC Auth Safety

- Fixed email-conflict identity creation in `completeOidcLogin`.
  - Before: a new random `userId` could be used for the OIDC identity/session even when `users.email` conflicted with an existing user.
  - After: the user upsert returns the canonical database user id, and OIDC identity/session rows use that id.
- Removed unsigned `id_token` fallback parsing.
  - Before: when `userinfo` was unavailable or failed, Alfred decoded JWT payload without signature, issuer, audience, or expiration verification.
  - After: login requires a successful userinfo response with `sub` and `email`.

### Runner Dev-Default Safety

- Stopped `ALFRED_ALLOW_DEV_CONFIG=1` and test mode from implicitly reading real `~/.codex` / `~/.claude`.
- Added safe empty fixture homes under `apps/runner/src/test/fixtures`.
- Updated `runner:local` to use fixture homes unless explicit source homes are supplied.

### API Route Wiring

- Removed duplicated manual `/v1/*` and `/api/v1/*` mount blocks.
- Removed hidden `createDb()` and env defaults from route factories.
- Added a small bootstrap-auth gate so request middleware does not repeatedly await an already-resolved bootstrap promise.

### Test Reliability

- Replaced microtask-flush guesses in terminal persistence tests with `flushTerminalPersistence()`.
- Added regression coverage that failed isolated-worktree preparation does not spawn a terminal process or register a session.
- Added subprocess `error` handlers and hard timeouts to script tests.
- Added env cleanup to the web Vite config test.
- Cleaned runner test temp directories after tests.

### Parser And Adapter Fragility

- Tightened Alfred LLM JSON extraction:
  - raw JSON object is accepted,
  - fenced JSON is accepted,
  - prose with an unfenced embedded object is rejected and retried instead of being silently scraped.
- Improved Claude project-key fallback so common hyphenated project names such as `client-app` are preserved when `cwd` is absent.

### Duplicate UI Rules

- Extracted shared session-title normalization.
- Extracted shared workspace short-label generation.
- Reused both helpers from main and renderer code paths.

## Findings Left As Follow-Ups

- Desktop integration tests still pass but emit React `act(...)` warnings. This is test-harness noise and should be cleaned separately because it spans many existing App integration cases.
- `LOCAL_*` constants live in `@alfred/schema` and are re-exported by `@alfred/db`. This keeps dependency direction clean for the runner, but it is still a product/runtime constant living in a schema package.
- `OPS_SMOKE_PROJECT_KEY` is still a hardcoded system-project filter in the runs query service. It should become config or a first-class system-project concept if more internal project keys appear.
- Ingest still provisions local bootstrap tenancy in the ingest path. This is functional, but bootstrap ownership is split between auth bootstrap and ingest bootstrap.

## Verification

- `pnpm typecheck` — pass.
- `pnpm test` — pass.
- `pnpm build` — pass.
- `node --test scripts/test/*.test.mjs` — pass.
- `git diff --check` — pass.

Known non-failing warnings:

- Desktop Vite build still reports the renderer chunk over 500 kB.
- Desktop React tests still emit `act(...)` warnings.
