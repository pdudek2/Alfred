# Agent Sanity Review — Alfred

- **Date:** 2026-07-29
- **Reviewed commit:** `3544486` (`main`), working tree dirty (untracked `.impeccable/`, `.tmp/`)
- **Mode:** whole-repository, report-only

## Scope and coverage

- **Reviewed:** whole repository at `main` / `3544486`.
- **Mode:** whole-repository, report-only. No repository files were changed by this audit.
- **Languages/frameworks inferred:** TypeScript monorepo (pnpm 10 + turbo); Electron 42 main/preload/renderer; React 19 + Vite; Hono API on Vercel serverless; Drizzle + Postgres; better-sqlite3 outbox; node-pty + xterm.js; Vitest, node:test, Playwright.
- **Validation commands run (current execution):** `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm exec turbo run typecheck --force`; `pnpm exec turbo run test --force`; `pnpm exec vitest run src/renderer/app.test.tsx` ×5; `pnpm --filter @alfred/desktop... build`; `pnpm smoke:electron`; `git worktree list`; `lsof -iTCP:5173`.
- **Commands inspected but not run:** `pnpm smoke:cloud*`, `runner:service:*`, `purge-old-runs.mjs`, `drizzle-kit migrate` (network / service / destructive).
- **Existing artifacts consulted:** `docs/audits/local-artifacts/2026-07-28-*/OBSERVATION.md` (J0 receipts), `playwright.config.ts`. Labeled as history where cited, never as reproduced.
- **Runtime tools used:** real Electron via the repository's own Playwright harness. No Computer Use; no browser automation beyond that harness.
- **Limits and assumptions:** two review workers (developer tooling/scripts, and CSS/design-system) were stopped mid-run to control cost, so those boundaries are **Blocked**. Root configuration, CI, and quality-gate integrity were covered directly by the lead. Every P1 below was independently verified by the lead against source; each detailed finding records whether the lead re-inspected the evidence personally. Turbo caching meant the first `pnpm test` was partly a **replay of logs recorded in a stale `.worktrees/phase-e-quality-gate` path** — all pass/fail claims below come from `--force` runs.

### Coverage matrix

| Boundary | Static/contract review | Runtime/validation | Status | Remaining gap |
|---|---|---|---|---|
| `apps/desktop/src/main` (PTY, IPC, OS) | Full | Electron smoke 14/15 | Complete | node-pty write with non-string payload unexercised |
| `apps/desktop/src/main` (persistence, worktrees, sessions) | Full | Unit (real fs) | Complete | Real `git` never invoked by any test |
| `apps/desktop/src/renderer` shell + TerminalDesk | Full | jsdom + real Electron | Complete | — |
| `apps/desktop/src/renderer` components + projections | Full | jsdom | Complete | — |
| `apps/desktop` styles / design contract | **Not performed** | — | **Blocked** | `styles.css` (6703 L) and `styles-contract.test.ts` (2248 L) unreviewed |
| `apps/api` (auth, routes, services) | Full | 64 tests, no real DB | Partial | No test touches real Postgres or the Drizzle store |
| `apps/runner` + `packages/{schema,adapters,db}` | Full | Executed probes vs built `dist` | Complete | Real `~/.claude` sizes not measurable (out of scope) |
| `drizzle/**` vs `packages/db/src/schema.ts` | Full programmatic diff | — | Complete | **No drift found** |
| `api/**` Vercel shim + `vercel.json` | Read | Not deployed | Partial | Handler export shape unverified without a deploy |
| `scripts/**` + `scripts/test/**` | **Not performed** | — | **Blocked** | `purge-old-runs`, `runner-service`, `dev-doctor`, `cloud-smoke`, `build-vercel-api` unreviewed |
| Root config, CI, quality gate | Full (lead) | `--force` runs | Complete | — |
| Test surface (false confidence) | Full census + targeted reads | — | Complete | — |

## Executive summary

The engineering discipline here is genuinely above average: strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), typed-lint rules including `no-floating-promises`, zero `.skip`/`.only`/`.todo`, `retries: 0`, no snapshots, no truthiness assertions, and a real-Electron gate that fails on any renderer console error. The xterm keep-alive invariant — the product's stated #1 constraint — is correctly implemented **and** proven at real-Electron fidelity. Migrations and the Drizzle schema are in exact agreement.

**But the repository is not currently green, and the gate said it was.** `pnpm test` passed only by replaying turbo cache entries recorded in a stale worktree; forced execution fails, and `pnpm smoke:electron` fails 1/15. Two independent defects, both reproduced.

The concentration of real risk is in **silent data loss**: three separate paths destroy user data with no warning and no recovery (quit-time terminal snapshot wipe, corrupt-state reset-then-overwrite, per-source ingest watermark). The runner has three availability defects that each permanently stall ingestion. The API has two authorization gaps whose severity depends on the identity-provider audience.

Verdict: **cleanup-worthy before release, with several likely-broken paths.** Not shippable as Phase Z release-readiness until the gate is honestly green and the data-loss paths are closed.

## Top findings

| Sev | Assessment | Category | Location | Finding | Action | Conf | Auto-fix |
|---|---|---|---|---|---|---|---|
| P1 | likely-broken | test-environment | `app.test.tsx:3275` | Unit test makes a real network call; fails whenever anything listens on :5173 | Stub `fetch` | High | With validation |
| P1 | likely-broken | correctness | `TerminalDesk.tsx:213` | `preventDefault` in a passive wheel listener — guard is a no-op, gate fails | Native non-passive listener | High | With validation |
| P1 | likely-broken | data-loss | `terminal-manager.ts:797` | Quit flush wipes all persisted sessions when hydration never ran | Await hydration first | High | With validation |
| P1 | risky | data-loss | `persisted-desktop-state.ts:634` | Invalid state silently reset, then overwritten — no backup, no migration | Quarantine + migrate seam | High | With validation |
| P1 | likely-broken | correctness | `app.tsx:1432` | Rejected `requestPlan` leaves composer permanently disabled | try/catch → `errored` | High | Yes |
| P1 | likely-broken | availability | `apps/runner/src/index.ts:37-46` | One invalid record halts all ingestion, including flush of queued events | Skip per record | High | With validation |
| P1 | likely-broken | data-loss | `apps/runner/src/index.ts:159` | Per-source watermark silently drops events from concurrent sessions | Key cursor per session | High | No |
| P1 | risky | availability | `outbox-worker.ts:60` | Poison batch retries forever; no cap, no dead-letter, prune is dead code | Cap attempts | High | With validation |
| P1 | risky | authz | `routes/auth.ts:71` | Logout never revokes the session; `revoked_at` is never written | Write revocation | High | Yes |
| P1 | risky | authz | `oidc-auth.ts:101` | Any principal the IdP admits lands in the bootstrap workspace | Explicit allowlist | High | With validation |
| P1 | likely-broken | integration | `AgentTimelinePanel.tsx:530` | Inbox "Review / Edit" is a dead end for blocked codex/claude tiles | Widen gate or stop emitting | High | With validation |
| P1 | risky | test-coverage | `ingest.test.ts:85` | Run-lifecycle asserted against a reimplementation of itself | Test the real store | High | No |
| P2 | risky | resource-leak | `terminal-manager.ts:354` | Closing a live isolated session orphans the worktree and deletes its metadata | Decide one behavior | High | No |
| P2 | risky | observability | `main.ts:162` | `onWarning` never wired — every state read/parse failure is silent | Pass a handler | High | Yes |
| P2 | risky | privacy | `terminal-manager.ts:861` | Agent prompts + absolute paths persist unredacted; neither privacy control clears them | Redact/drop `args` | High | With validation |
| P2 | risky | privacy | `redactor.ts:8-28` | Redactor misses URI credentials and mainstream token formats | Add patterns + fixtures | High | With validation |
| P2 | risky | correctness | `app.tsx:961` | Destructive IPC inside `setState` updaters — fires twice under StrictMode | Move IPC out | High | With validation |
| P2 | risky | correctness | `alfred-launch-preflight.ts:75` | Deleted workspace folder reports "Ready", then fails at spawn | Stat the root | Medium | No |
| P2 | risky | data-integrity | `persisted-desktop-state.ts:141` | Failed mutation dropped by the next success; UI reports "saved" | Keep or merge | High | With validation |
| P2 | risky | correctness | `ingest-service.ts:80` | Parent-run status clobbered by the child event's type | Synthesize minimally | High | With validation |
| P2 | risky | config | `packages/db/src/client.ts:10` | `DATABASE_URL` unvalidated; hosted silently falls back to localhost | Require in hosted | High | Yes |
| P2 | risky | correctness | `app.ts:45` | Documented dev-auth login is inert outside `NODE_ENV=test` | Fix or delete + doc | High | With validation |
| P2 | cleanup | correctness | `session-activity.ts:375,377` | Regex alternation precedence misclassifies file operations | Add groups | High | Yes |
| P2 | risky | data-loss | `outbox-worker.ts:25-30` | Discarded outbox records are hard-deleted with no log | Log before delete | High | Yes |

## Detailed findings

### 1. Preview panel performs a real network request; its unit test asserts the offline branch

- **Location:** `apps/desktop/src/renderer/components/WorkspacePreviewPanel.tsx:50`; test at `apps/desktop/src/renderer/app.test.tsx:3275`
- **Category:** test-environment dependency
- **Root cause:** the component's reachability probe is an unstubbed `fetch()` to a real URL, and nothing in `test-setup.ts` intercepts it.
- **Assessment:** likely-broken
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Current execution (lead-verified)
- **Evidence:** `void fetch(selected.url, { cache: "no-store", mode: "no-cors", signal })` — resolve ⇒ `online`, reject ⇒ `offline`. The test fixture buffer contains `http://localhost:5173/`, and line 3275 asserts `findByText("Preview is offline")`. A Vite dev server from an unrelated project (`~/Desktop/IronLog`, PID 9285) started at 00:20:18 — between a passing run (00:19:32, 911/911) and a failing forced run (00:22:50). Five subsequent isolated runs of the file: **5/5 failed**, all at `:3275`, with the failure DOM still showing the live `<iframe src="http://localhost:5173/">`.
- **Why it matters:** 5173 is *the* default Vite port. Any developer with any other Vite project running fails the release gate for a reason unrelated to their change, and the failure message points at the Preview feature.
- **Suggested action:** stub `fetch` in `test-setup.ts` or inject the probe; if the real probe is deliberate, use a port that is not a well-known default.
- **Auto-fix safety:** With validation

### 2. `preventDefault()` inside a passive wheel listener — the scroll-chaining guard does nothing

- **Location:** `apps/desktop/src/renderer/components/TerminalDesk.tsx:213` (handler at `:189`, bound at `:300`)
- **Category:** correctness (runtime)
- **Root cause:** React registers `wheel` at the root container as a **passive** listener, so `preventDefault()` from an `onWheelCapture` handler is ignored.
- **Assessment:** likely-broken
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Current execution (lead-verified)
- **Evidence:** `pnpm smoke:electron` → **1 failed, 14 passed**. `e2e/inbox.spec.ts:175` fails via `assertNoRuntimeErrors` (`e2e/support/electron-app.ts:157`) on four occurrences of `[renderer/error] Unable to preventDefault inside passive event listener invocation.` The handler runs `column.scrollTop += event.deltaY` then `event.preventDefault()`; since the latter is ignored, the browser *also* applies its native scroll to the same element.
- **Why it matters:** two defects from one cause — the terminal-column scroll-chaining guard silently double-scrolls, and the documented release gate (`pnpm verify`) fails. `playwright.config.ts` sets `retries: 0`, so this is not masked.
- **Suggested action:** attach the wheel listener natively via a ref with `{ passive: false }`.
- **Auto-fix safety:** With validation

### 3. Quit-time flush wipes every persisted terminal session when hydration never ran

- **Location:** `apps/desktop/src/main/terminal-manager.ts:797` (`persistTerminalSnapshots`), reached from `main.ts:219-222`
- **Category:** data loss
- **Root cause:** the function awaits an *in-flight* hydration but never *starts* one, then replaces the persisted array wholesale.
- **Assessment:** likely-broken
- **Severity:** P1
- **Confidence:** High (mechanism), Medium (trigger rate)
- **Evidence provenance:** Static trace (lead-verified)
- **Evidence:** `const hydration = persistenceHydration; if (hydration) await hydration;` then `updateState(current => ({ ...current, restoredTerminalSessions: [...restoredSessionSnapshots.values()]... }))`. `restoredSessionSnapshots` is populated only by `hydratePersistedTerminalSessions()`, called from three places — `terminalChannels.list` (`:169`), `worktreeOperationRequest` (`:677`), `isExactPersistedRestoredLaunch` (`:1082`) — **none on the quit path**. `main.ts:219` calls `flushTerminalPersistence()` unconditionally on the first `before-quit`, and `flushTerminalPersistence` (`:459`) calls the persist function directly.
- **Why it matters:** quit before the renderer ever issues `terminal:list` (renderer fails to load, dev server down, quit during startup) and every saved session and scrollback is replaced with `[]`. The sibling race is already guarded and tested (`terminal-manager.test.ts:587`); this variant is not.
- **Suggested action:** `await hydratePersistedTerminalSessions()` before reading the map, or bail when `!persistenceHydrated && restoredSessionSnapshots.size === 0`.
- **Auto-fix safety:** With validation

### 4. Invalid or corrupt desktop state is silently reset, then overwritten

- **Location:** `apps/desktop/src/main/persisted-desktop-state.ts:634-636`, `:645-656`
- **Category:** data loss
- **Root cause:** version/parse mismatch is a hard reset with no quarantine copy and no migration seam.
- **Assessment:** risky
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Static trace (lead-verified)
- **Evidence:** `if (!isRecord(parsed) || parsed.version !== DESKTOP_STATE_VERSION) return cloneDesktopState(DEFAULT_DESKTOP_STATE);` — this branch does not even call `onWarning`, unlike the read (`:627`) and parse (`:640`) branches. `hydrate` (`:128`) caches the defaults and the next `updateState` → `writeDesktopStateFile` `rename`s over the original. There is no migration table (`DESKTOP_STATE_VERSION = 1` is the only version) and no `.bak`.
- **Why it matters:** every workspace binding, saved layout, staged plan and restored session is destroyed within seconds of launch, irrecoverably. Reachable **today** via a truncated file — and `writeDesktopStateFile` performs no `fsync`, so an unclean shutdown can leave exactly that.
- **Suggested action:** rename the existing file to `desktop-state.corrupt-<ts>.json` before returning defaults; add a `migrate(parsed)` seam so version bumps upgrade rather than reset.
- **Auto-fix safety:** With validation

### 5. A rejected `requestPlan` disables the composer permanently

- **Location:** `apps/desktop/src/renderer/app.tsx:1431-1432`; counterparty `apps/desktop/src/main/alfred-orchestrator.ts` (`planRequest`)
- **Category:** correctness / error handling
- **Root cause:** an irreversible state transition followed by an unguarded `await`.
- **Assessment:** likely-broken
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Static trace (lead-verified)
- **Evidence:** `setAlfredStatus(thinking()); const response = await alfredApi.requestPlan({...});` with no `try`/`catch`. Both exits from `thinking` (`errored` at `:1438`, `idle` at `:1441`) are after the await. `composer.tsx:32` `composerDisabled = disabled || thinking || !dispatchTarget` then disables textarea and send button forever. Rejection is reachable: the `planRequest` handler is `try { ... } finally { inFlight = false; }` with **no catch**, and `preflightAlfredPlan` inside that try performs `fs` stats and `sh -lc` spawns. The sibling handler `planSessionUpdate` in the same file *does* catch — `planRequest` is the outlier.
- **Why it matters:** Prepare Work — the primary entry point — becomes unusable until restart, with no error surfaced and the popover stuck on "Preparing work in X."
- **Suggested action:** wrap the await in `try/catch` → `setAlfredStatus(errored({ code: "network", message }))`; add a `catch` to `planRequest` matching its sibling.
- **Auto-fix safety:** Yes

### 6. One schema-invalid record halts all ingestion, including flush of already-queued events

- **Location:** `apps/runner/src/index.ts:37-46`; throw site `sources/codex/codex-adapter.ts:317`, `sources/claude/claude-adapter.ts:301`
- **Category:** availability
- **Root cause:** `collect()` throws per record and runs before `flushOutbox` inside the same try-scope.
- **Assessment:** likely-broken
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Executed reproduction (worker, against built `dist`) + static trace (lead-verified)
- **Evidence:** the loop `for (const adapter of adapters) { const events = await adapter.collect(); ... }` precedes `const flushedEvents = await flushOutbox(...)`. A record with `"timestamp":"…+02:00"` fails `IngestEventSchema` (`ingest.ts` uses offset-rejecting `z.string().datetime()` while `env.ts:16` uses `datetime({ offset: true })` — the repository disagrees with itself), rejecting the whole `collect()`. `runRunnerLoop` logs and retries the same file forever.
- **Why it matters:** a single malformed record in a file the runner does not control stalls ingestion permanently, and the outbox never drains.
- **Suggested action:** catch per record in `codexRecordToEvent`/`claudeRecordToEvents`, skip and count; move `flushOutbox` out of the collect failure path.
- **Auto-fix safety:** With validation

### 7. Per-source watermark permanently drops events from concurrently-written sessions

- **Location:** `apps/runner/src/index.ts:159-178` (`updateSourceCursor`/`maxOccurredAt`); filter at `codex-adapter.ts:64`
- **Category:** data loss
- **Root cause:** one cursor per *source* set to the max `occurred_at` across *all* session files, while sessions are written concurrently by independent agents.
- **Assessment:** likely-broken
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Executed reproduction (worker) + static trace (lead-verified)
- **Evidence:** `outbox.setSourceCursor(sourceId, maxOccurredAt(events))` — a single key. Session A ending 10:00 and session B at 09:00 collected together set the cursor to 10:00; B's subsequent 09:30 record is filtered by `occurredAtMs <= codexSinceMs` before it ever reaches the outbox, so the outbox's at-least-once guarantee does not cover it.
- **Why it matters:** the product premise is multiple concurrent agent sessions. Slower sessions silently lose events, with no error and no retry — this would present as runs missing steps.
- **Suggested action:** key the cursor per session file (path or `source_run_id`) rather than per source.
- **Auto-fix safety:** No (changes the `source_cursors` key shape)

### 8. Poison batch retries forever; no attempt cap, no dead-letter, prune is dead code

- **Location:** `apps/runner/src/outbox/outbox-worker.ts:60-63`; `outbox-db.ts:103`
- **Category:** availability
- **Root cause:** `attempts` is incremented but only ever read for backoff.
- **Assessment:** risky
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Executed reproduction (worker) + static trace (lead-verified)
- **Evidence:** `nextRetryAt` = `min(60_000, 2 ** record.attempts * 1000)`; `attempts` appears exactly once in the worker; grep for `MAX_ATTEMPT|deadLetter` across worker and db returns nothing. `pruneFailedBefore` has **zero** production callers (only its own definition and `outbox.test.ts:137`). `apps/api/src/routes/ingest.ts:32-35` returns 400 for the *whole batch* if any one event fails validation, and the runner does not bisect.
- **Why it matters:** on a long-lived launchd service one bad event blocks every event behind it indefinitely while the SQLite file grows without bound.
- **Suggested action:** cap `attempts` (dead-letter or drop with a log) and schedule `pruneFailedBefore`.
- **Auto-fix safety:** With validation

### 9. Logout never revokes the session

- **Location:** `apps/api/src/routes/auth.ts:71-74`
- **Category:** authorization / session lifecycle
- **Root cause:** revocation is modeled in the schema but never written.
- **Assessment:** risky
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Static trace (lead-verified)
- **Evidence:** the handler only calls `clearCookie`. Repository-wide, `revokedAt` appears in exactly three places — the column (`packages/db/src/schema.ts:143`), the migration (`drizzle/0002_trust_first_auth.sql:19`), and one read filter (`session-auth.ts:71` `isNull(sessions.revokedAt)`). No `UPDATE … SET revoked_at` exists anywhere. Session lifetime is 30 days (`oidc-auth.ts:107`) and `lastSeenAt` is never written either.
- **Why it matters:** "log out" only clears the local cookie. A token captured from a shared machine or a proxy log stays valid for up to 30 days, and there is no operator path to kill it short of manual SQL.
- **Suggested action:** in `/logout`, hash the cookie value and set `revokedAt` before clearing.
- **Auto-fix safety:** Yes

### 10. Every OIDC-authenticated principal is placed in the shared bootstrap workspace

- **Location:** `apps/api/src/auth/oidc-auth.ts:95-108`
- **Category:** authorization
- **Root cause:** identity is treated as authorization; the fallback grants the shared bootstrap workspace.
- **Assessment:** risky
- **Severity:** P1
- **Confidence:** High (mechanism), Medium (impact depends on IdP audience)
- **Evidence provenance:** Static trace (lead-verified)
- **Threat assumption:** the configured `AUTH_OIDC_ISSUER` admits more principals than the intended operator. If it is a private single-user app registration, impact is nil.
- **Evidence:** `const workspaceId = workspace?.id ?? config.bootstrapWorkspaceId;`. `insert(workspaces)` exists in only two places — `bootstrap-auth.ts:29` and `ingest-service.ts:224` — so nothing provisions a workspace for a new OIDC user, and there is no `workspace_members` table or any membership model. Any user completing `/auth/callback` therefore gets a session on the bootstrap workspace and can read `/v1/runs`, whose `payload` carries agent transcript content.
- **Why it matters:** the README documents OIDC as *the* production login and mentions no allowlist; the code has none.
- **Suggested action:** gate `completeOidcLogin` on an explicit allowlist and refuse rather than falling back to `bootstrapWorkspaceId`.
- **Auto-fix safety:** With validation

### 11. Inbox "Review / Edit" is a dead end for blocked Codex/Claude staged sessions

- **Location:** `apps/desktop/src/renderer/components/AgentTimelinePanel.tsx:529-531`; producer `apps/desktop/src/renderer/attention-projection.ts:98-113`
- **Category:** integration (half-wired action)
- **Root cause:** the editor's gate is narrower than the condition that produces the action.
- **Assessment:** likely-broken
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Static trace (lead-verified)
- **Evidence:** `projectBlockedSafety` returns `action: { kind: "review-edit" }` for **any** staged session where `isLaunchBlocked` holds, with no `agentKind` filter. `isLaunchBlocked` (`session-state.ts:404`) is `Boolean(session.safetyNote) || launchPreflight?.status === "blocked"`, and `alfred-llm.ts:282-286` applies `checkSafety` to every plan session regardless of kind. But the editor is gated on `session.stage === "staged" && (session.agentKind === "shell" || session.agentKind === "dev-server")`, and `onUpdateStagedSession` has exactly one call site in the whole renderer.
- **Why it matters:** a blocked Codex/Claude tile shows a "Review / Edit" button that opens a panel with no edit control. Launch is refused and the item is stuck in the "needs you" queue permanently.
- **Suggested action:** either widen `isEditableStagedSession` to all staged sessions (safety is re-checked on save), or stop emitting `review-edit` for kinds the editor will not accept.
- **Auto-fix safety:** With validation

### 12. The ingest run-lifecycle state machine is asserted against a reimplementation of itself

- **Location:** `apps/api/src/test/ingest.test.ts:85` (`makeInMemoryStore`), affecting tests at `:206`, `:238`, `:289`, `:320`
- **Category:** test coverage / false confidence
- **Root cause:** the production store is module-private and untested; the test injects a fake that re-implements the same logic.
- **Assessment:** risky
- **Severity:** P1
- **Confidence:** High
- **Evidence provenance:** Static trace (worker; lead confirmed the constraint half — see below)
- **Evidence:** `ingestBatch()` delegates all run-lifecycle logic to `store.upsertRun`; the test fake re-implements `runStatusForTest`, `runTimestampsForTest` and the reopen guard inside the test file. `createDrizzleIngestStore` (`ingest-service.ts:163`, ~200 lines) is never exported and referenced by zero tests. Inverting the reopen rule in production leaves all four named tests green.
- **Related, resolved during verification:** the sibling concern about ingest dedup is **not** a live bug — `events_workspace_event_id_unique` (`drizzle/0001`) and `events_workspace_source_event_unique` (`drizzle/0000`) both exist and match `schema.ts:309-310`. Dedup is correct in production; it is only the *test* that proves a JS `Set`.
- **Why it matters:** run status drives the Inbox/attention surface. A production reopen bug shows stale "completed" runs while 64 green API tests report success.
- **Suggested action:** export `createDrizzleIngestStore` and run the four cases against pglite/testcontainers, or assert emitted SQL using the `PgDialect().sqlToQuery` pattern already present at `runs.test.ts:369`.
- **Auto-fix safety:** No

### 13. Closing a live isolated-worktree session orphans the worktree and deletes its only metadata

- **Location:** `apps/desktop/src/main/terminal-manager.ts:354` and `:939`; consumer `apps/desktop/src/renderer/app.tsx:980`
- **Category:** resource leak / contract gap
- **Root cause:** worktree cleanup is gated on `request.cleanupWorktree`, which no production caller sets, while `killSession` unconditionally passes `forgetSnapshot: true`.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Static trace (worker; lead not independently re-inspected)
- **Evidence:** `handleCloseSession` sets `destructiveWorktreeCleanup` only for `restored|exited|error`, so a running agent tile always takes `terminalApi?.kill({ id })` with no `cleanupWorktree`. `killSession` then calls `forgetPersistedSession(clientId)`, discarding `branchName`/`baseCwd`/`cwd`. `cleanupWorktree` has zero non-test callers; the only exercise is `terminal-manager.test.ts:1639`, whose title says "forgotten" but which emits `kill` — certifying a path the product never takes.
- **Why it matters:** every closed running worktree session leaves a git worktree and branch under `userData/worktrees/` that the UI can no longer reach, accumulating unboundedly.
- **Suggested action:** pick one behavior and make both sides agree — retain the snapshot so review/apply stays possible, or route the live close through `forget({cleanupWorktree:true})`. Fix the test title regardless.
- **Auto-fix safety:** No (product decision on uncommitted agent work)

### 14. `onWarning` is never wired, so every state read/parse failure is silent

- **Location:** `apps/desktop/src/main/main.ts:162`; declaration `persisted-desktop-state.ts:82`
- **Category:** observability
- **Root cause:** the only production construction omits the diagnostic callback the module is built around.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Static trace (lead-verified)
- **Evidence:** `createPersistedDesktopStateStore({ userDataPath: app.getPath("userData") })` — no `onWarning`. Repository-wide grep confirms the identifier appears only as the optional parameter and its three no-op call sites (`:149`, `:627`, `:640`). Write failures surface via `saveStatus`; read failures have no channel at all.
- **Why it matters:** this is the amplifier for finding 4 — the silent wipe produces no log line and no notification, so there is nothing to diagnose afterwards.
- **Suggested action:** pass at minimum `onWarning: (message, error) => console.error(message, error)`.
- **Auto-fix safety:** Yes

### 15. Agent prompts and absolute paths persist unredacted, and neither privacy control removes them

- **Location:** `apps/desktop/src/main/terminal-manager.ts:861-878`; `persisted-desktop-state.ts:541-544`; `desktop-state-ipc.ts:46-49`
- **Category:** privacy
- **Root cause:** redaction is applied to `title`, `buffer` and `activityEvents`; the agent argv is treated as metadata.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Static trace (worker; lead not independently re-inspected)
- **Evidence:** `const redactedBase = { ...baseSession, title: redactText(baseSession.title) };` — `command`, `args`, `cwd`, `baseCwd`, `branchName` pass through verbatim, and the normalize side copies them verbatim too. `args` carries the user's prompt: `shared/agent-command.ts:38-52` exists specifically to rewrite `--prompt <text>` into a positional argument. `terminalScrollbackRetention: "off"` clears only `buffer`/`activityEvents`; "Clear saved terminal data" destructures out `activityEvents`/`lastActivityAt`/`lastOutputAt` and returns `{ ...rest, buffer: "" }`.
- **Why it matters:** a user who sets retention to "off" **and** presses "Clear saved terminal data" still has full agent prompts and absolute local paths in `desktop-state.json` — a file `revealStateFile` invites them to open and share.
- **Suggested action:** apply `redactText` to `command`/`args`; drop or placeholder them in the `"off"` branch and in `clearSavedTerminalData`.
- **Auto-fix safety:** With validation (dropping `args` affects restore fidelity)

### 16. The redactor misses URI-embedded credentials and several mainstream token formats

- **Location:** `packages/schema/src/redactor.ts:8-28`
- **Category:** privacy
- **Root cause:** the pattern set is a keyword allowlist plus five vendor prefixes, with no URI-userinfo rule and no generic high-entropy rule.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Executed probe (worker, 31 payloads against built `dist`)
- **Threat assumption:** an agent prints a connection string, a `.env`, or a vendor key into output that reaches a redacted field.
- **Evidence:** leaked verbatim — `postgresql://alfred:sup3rs3cret@db.example.com:5432/alfred`; `https://user:ghp_xyz@github.com/a/b.git`; Stripe `sk_live_…` (the `\bsk-` pattern requires a hyphen); Google `AIza…`; `glpat-`, `npm_`, `SG.`; and `{"api_key": "abc123"}` as a JSON string (the quote before `:` breaks the assignment pattern). Separately, `HEADER_SECRET_PATTERN`'s value group stops at the first delimiter: `Cookie: session=abc123SECRET; csrf=xyz789LEAK` → `Cookie: [redacted]; csrf=xyz789LEAK`.
- **Why it matters:** blast radius inside the runner is small (payloads are enumerated scalars), but `apps/desktop` passes **entire terminal scrollback buffers** through this same function, which makes its coverage the deciding control. The existing tests only assert on short hand-built strings that already match a known pattern, so they cannot fail on an unknown format.
- **Suggested action:** add URI-userinfo and the missing vendor prefixes; add a realistic `.env`-dump fixture; fix the header value group to consume the full value.
- **Auto-fix safety:** With validation (regex widening needs over-match review)

### 17. Destructive IPC inside `setState` updaters fires twice under StrictMode

- **Location:** `apps/desktop/src/renderer/app.tsx:961-988` (`closeSessionNow`), plus `:510`, `:734`, `:830`, `:847`, `:907`, `:1442`, `:1577`
- **Category:** React correctness
- **Root cause:** impure state updaters performing side effects.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Static trace (worker; lead not independently re-inspected)
- **Evidence:** `main.tsx:12` enables `StrictMode`, which double-invokes updaters in dev. `closeSessionNow` performs `terminalApi?.forget({ clientId, cleanupWorktree: true })`, `terminalApi?.kill(...)`, a ref mutation and a `setTimeout` **inside** the `setTerminalSessions` updater — so a destructive worktree cleanup runs twice per close in development. `:1442` additionally mints a fresh `crypto.randomUUID()` per invocation.
- **Why it matters:** duplicated destructive IPC in dev; in production correctness is accidental, since any concurrent-render rebase re-invokes updaters.
- **Suggested action:** `terminalSessionsRef.current` is already maintained (`:312`) — derive the next state from it and fire IPC outside the updater.
- **Auto-fix safety:** With validation (several tests assert IPC call counts)

### 18. A deleted workspace folder reports "Ready", then fails at spawn

- **Location:** `apps/desktop/src/main/alfred-launch-preflight.ts:75-83`; no existence check in `workspace-store.ts:97-100`
- **Category:** integration / error reporting
- **Root cause:** `rootPath` is treated as a validated invariant after binding and never re-verified.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** Medium
- **Evidence provenance:** Static trace (worker; lead not independently re-inspected)
- **Evidence:** `normalizeWorkspaces` only trims the string; `getWorkspaceState` never stats the path. For a deleted folder: `resolveGitBranch` fails and is swallowed (`catch { return undefined }`), the renderer still renders it as healthy, and `preflightAlfredPlanSession` takes the truthy branch and returns `{ status: "ready", label: "Ready" }`. `canonicalMissingPath` resolves to the nearest existing ancestor, so the allow-list check passes for a nonexistent directory too.
- **Why it matters:** this is the gap behind the open product task about a recoverable missing-folder state. `SessionLifecycle`'s `"recoverable"` is produced only for restored *managed sessions*, never for workspaces.
- **Suggested action:** stat `rootPath` in `getWorkspaceState`, expose `rootPathMissing` on `WorkspaceSnapshot`, and have the preflight return a blocked status. Keep the registry entry so it stays re-bindable.
- **Auto-fix safety:** No (needs a shared-type change plus a renderer surface)

### 19. A failed state write is discarded by the next success, which reports "saved"

- **Location:** `apps/desktop/src/main/persisted-desktop-state.ts:141-158`
- **Category:** data integrity
- **Root cause:** `failedState` is a single slot reset unconditionally on any success, without ever being merged.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Static trace (lead-verified)
- **Evidence:** on failure `failedState = nextState` and `cachedState` is *not* advanced, so the next `updateState` bases its updater on the pre-failure snapshot. On the next success, `cachedState = nextState; failedState = null; setSaveStatus({ status: "saved" })`. `retrySave` (`:189-197`) then takes its `if (!failedState)` branch and returns the cached state — reporting success for a change never written.
- **Why it matters:** a transient write failure followed by any later save silently loses the failed mutation and removes the user's "Retry save" affordance, while the UI says "saved".
- **Suggested action:** keep `failedState` until it is successfully written, or fold it into the base state for the next updater; never report "saved" while an unpersisted `failedState` exists.
- **Auto-fix safety:** With validation

### 20. Parent-run status is clobbered by the child run's event type

- **Location:** `apps/api/src/services/ingest-service.ts:80-91`, defeated by `:140-148` and `:309`
- **Category:** correctness
- **Root cause:** `runStatusFor` branches on `event.type` before consulting `event.status`, so the `status: "unknown"` sentinel is inert.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Static trace (worker; lead not independently re-inspected)
- **Evidence:** the parent is synthesized by spreading the child event (`{ ...event, source_run_id: event.parent_source_run_id, status: "unknown" }`), which retains the child's `type` and `occurred_at`. `runStatusFor` returns `"completed"` for `event.type === "run.completed"` before reading `event.status`, so the `case when excluded.status = 'unknown'` guard at `:319-325` — written for exactly this — never fires. No test covers `parent_source_run_id` status.
- **Why it matters:** parent runs display completed/failed while still running, and `deriveRunLifecycleStatus` propagates it to `lifecycle_status`.
- **Suggested action:** synthesize the parent from a minimal object with no status/timestamps, or make `runStatusFor` honor an explicit `"unknown"` override.
- **Auto-fix safety:** With validation

### 21. `DATABASE_URL` is never validated; hosted runtime silently falls back to localhost

- **Location:** `packages/db/src/client.ts:10`; absent from `apps/api/src/env.ts:24-51`
- **Category:** configuration
- **Root cause:** `env.ts` validates every other required variable but omits the one the README lists first.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Static trace (worker; lead not independently re-inspected)
- **Evidence:** `createPool(connectionString = process.env.DATABASE_URL ?? "postgresql://alfred:alfred@localhost:54329/alfred")`. A deployment missing the variable starts, serves `/health` 200, and fails every data route with an opaque ECONNREFUSED 500 — including ingest, so the runner reports status-500 indefinitely while the smoke check stays green.
- **Why it matters:** `/health` returning 200 makes a totally broken deployment look healthy to `pnpm smoke:cloud`.
- **Suggested action:** add `DATABASE_URL: z.string().url()`, required when `isHostedRuntime(input)`.
- **Auto-fix safety:** Yes

### 22. The documented dev-auth login flow is inert outside `NODE_ENV=test`

- **Location:** `apps/api/src/app.ts:45-47`; `apps/api/src/auth/session-auth.ts:87-90`
- **Category:** documented guarantee not implemented
- **Root cause:** the static session store is reachable only via the *primary-threw* branch, which is enabled only under `NODE_ENV=test`.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Static trace + repository contract (worker; lead not independently re-inspected)
- **Evidence:** `createFallbackSessionStore(dbSessionStore, staticSessionStore, process.env.NODE_ENV === "test")`, and inside it `if (!catchPrimaryErrors) return primary.getSession(token);`. The API dev script is plain `tsx src/index.ts` with no `NODE_ENV`. With a reachable Postgres, `dbSessionStore.getSession("dev-session-token")` returns `null` (nothing seeds that session row) → 401. `/auth/login` still sets the cookie, so the failure is silent. This breaks the README's documented curl flow and `ALFRED_CLOUD_SMOKE_MODE=authenticated`. The test that "covers" it (`app.test.ts:121-132`) passes only because the `@alfred/db` mock has no `.select`, so the primary *throws* and the test-only branch is reached.
- **Why it matters:** a documented developer workflow does not work, and the test asserting it proves nothing about a real database.
- **Suggested action:** either make the static store a first-class fallback on `null` when `DEV_AUTH_ENABLED`, or delete the dev-cookie branch and correct the README. Do not widen the guard without re-checking the hosted-runtime rules in `env.ts`.
- **Auto-fix safety:** With validation

### 23. Regex alternation precedence misclassifies file operations

- **Location:** `apps/desktop/src/shared/session-activity.ts:375` and `:377`
- **Category:** correctness
- **Root cause:** missing group around the alternation, so `\b` binds to only one alternative.
- **Assessment:** cleanup
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Current execution (lead executed the regexes)
- **Evidence:** `/\bupdated|modified\b/i` parses as `(\bupdated)|(modified\b)`. Executed: `"unmodified file.ts"` matches the *updated* rule (true); `"rewritten config"` and `"overwritten output"` match the *wrote* rule (true). With the corrected `/\b(updated|modified)\b/i` and `/\b(wrote|written)\b/i`, all three correctly return false. Lines 372-374 and 376 use a single alternative and are correct, which makes the two broken ones look deliberate.
- **Why it matters:** these become `kind: "file"` activity events with a `file` payload, surface as "Reveal" buttons in the Context timeline, and are counted into the activity summary — so the UI offers to reveal files for output that said the opposite.
- **Suggested action:** `/\b(updated|modified)\b/i` and `/\b(wrote|written)\b/i`.
- **Auto-fix safety:** Yes

### 24. Discarded outbox records are hard-deleted with no log

- **Location:** `apps/runner/src/outbox/outbox-worker.ts:25-30`
- **Category:** data loss / observability
- **Root cause:** a discard path reusing the success verb.
- **Assessment:** risky
- **Severity:** P2
- **Confidence:** High
- **Evidence provenance:** Executed reproduction (worker) + static trace (lead-verified)
- **Evidence:** `if (!parsed.success || parsed.data.workspace_id !== config.workspaceId || parsed.data.device_id !== config.deviceId) { outbox.markSent([record.id]); continue; }` — and `markSent` is a `DELETE`. Three queued rows (one malformed, one foreign-workspace, one valid) → `flushed: 1`, `countQueued(): 0`, nothing emitted. The identity-mismatch arm, reachable on device re-pairing or a workspace-id change, has no test at all.
- **Why it matters:** unattributable telemetry loss, and it hides exactly the schema regressions that cause finding 6.
- **Suggested action:** log `event_id` and reason before deleting; decide whether identity-mismatched records should be quarantined rather than destroyed.
- **Auto-fix safety:** Yes

## UI/UX and runtime observations

**Observed runtime defects (current execution, real Electron, 14/15 passing):** only finding 2 — the passive-listener console errors that fail `e2e/inbox.spec.ts:175`. No crashes, blank screens, stuck loading, or broken navigation were observed in the 14 passing scenarios, which cover Work/Grid, Sessions with a real transcript, Inbox, Preview, workspace switching, the J0 accessibility surfaces, and the native window material at 1440×900 and 1120×720.

**Runtime coverage is genuinely strong.** The keep-alive invariant is asserted at real-Electron fidelity in 7 of 11 specs via `.xterm-screen` `isSameNode`, and `assertNoRuntimeErrors` runs in all 11 — that gate is why finding 2 surfaced at all rather than being logged and ignored.

**Static UI risks (not runtime-observed):** findings 11, 17, 23 above, plus accessibility attributes used without the behavior they promise:

- `role="tablist"`/`role="tab"` in `ProjectNavigator.tsx:89,119` with no `tabpanel`/`aria-controls`
- `role="listbox"`/`role="option"` in `CommandPalette.tsx:473,485` with focus on the input and no `aria-activedescendant`, so screen readers never announce the highlighted command
- `aria-expanded` on a bare `<li>` in `InboxDecisionItem.tsx:28`
- `role="dialog"` without a focus trap in `WorkspaceActionsMenu.tsx:167` and `PrepareWorkPopover.tsx:60`

Contrast ratios were **not** computed — the CSS boundary was not reviewed.

**Not covered:** the design-system/CSS boundary was **Blocked**, so no claim is made about token drift, dead CSS, contrast, or whether `styles-contract.test.ts` provides real protection.

## Suspicious but probably keep

- **`canAttachToWindow` lets any window adopt an orphaned session** (`terminal-manager.ts:915`). Looks like an ownership hole; it is the mechanism behind the keep-alive invariant and is pinned by `terminal-manager.test.ts:2358`.
- **`defaultCommandExists` shelling out with `sh -lc`** (`alfred-launch-preflight.ts:188`). The LLM-supplied command is passed as a `$1` positional and never interpolated into the script body — correctly written.
- **LLM-supplied title as a worktree/branch seed.** `git-worktree.ts` sanitizes via `sanitizeBranchName`/`safePathSegment` and rejects anything that changes under sanitization.
- **`external-url.ts` / `external-terminal.ts`.** Localhost-only allowlist; workspace-root allowlist plus `stat` plus array-arg `spawn` with no shell.
- **No PKCE or `nonce` in the OIDC flow.** Defensible: confidential client with a secret, CSRF covered by the state-cookie comparison, and identity read from the userinfo endpoint — `readUserInfo` explicitly refuses an `id_token` fallback, pinned by `oidc-auth.test.ts:114`. Since no JWT is trusted, `nonce` buys nothing.
- **Non-constant-time token comparison in the static stores.** Reachable only when the primary store throws under `NODE_ENV=test`; the real stores compare SHA-256 hashes in an indexed lookup.
- **`layout-store`/`staged-plan-store` in-memory fallbacks.** Look like migration residue, but `registerLayoutIpc()` runs before `configureLayoutPersistence`, so a request arriving in that gap legitimately needs them.
- **`readJsonlRecords` swallowing corrupt lines.** Correct for live-written files; deterministic `event_id` plus `INSERT OR IGNORE` makes re-reading idempotent.
- **Runner HTTPS enforcement** (`env.ts:142-159`) matches the README and fails closed. Device token is Bearer-only and never logged.
- **`redactText` over-matching prose** (`"The signature: valid"` → `[redacted]`). Noise, not risk — fails in the safe direction. No ReDoS: 400 KB with an unterminated PEM header redacts in 6 ms.
- **`app.tsx:1536` swallowing the first navigation click when recovery is armed.** Looks like lost input; it is a deliberate two-step safety gate pinned by parameterized tests at `app.test.tsx:6659`.
- **`{ skip: process.platform === "win32" }` in `dev-alfred-shutdown.test.mjs:12`** — the only conditional skip in the repository, and correct: it drives SIGTERM/`pgrep` semantics.
- **`ALFRED_CSS_EXTENDED_VISUAL_PROBES` / `ALFRED_CSS_TARGET_SCALE_FACTOR`** *add* probes when set and never remove a default assertion. Not a gate reduction.

### Investigate — no severity assigned

Real signals whose evidence was too thin for the full finding contract, or where lead verification was not performed:

- `refreshWorkspaceBranches` read-modify-write outside the mutation queue (`workspace-store.ts:131`) can revert a concurrent workspace bind
- Command-palette arrow-key order differs from rendered order (`CommandPalette.tsx:403`)
- Older activity events unreachable when a session has no raw events (`AgentTimelinePanel.tsx:221`)
- `codex-sessions.test.ts` leaks 23 temp dirs including a 10 MiB fixture, with no `afterEach`
- The same command string is formatted four different ways across Inbox / Context / Recovery / Sessions; only the Context form is shell-quoted
- `"Free Chats"` classification hardcoded to `/Documents/Codex` in two modules with drifted normalization
- Two dead modules with zero non-test importers: `workspace-navigation-copy.ts`, `workspace-session-summary.ts`
- `PrivacyPolicySchema`'s `denied_artifact_globs` deny-list filters nothing
- Reference-timing budget asserted only when `ALFRED_ENFORCE_SESSIONS_REFERENCE_TIMING=1`
- `git-worktree` porcelain parsers are validated only against hand-written fixtures — real `git` is never invoked by any test

## Recommended next actions

1. **Make the gate honest first.** Fix findings 1 and 2 so `pnpm verify` passes on a clean machine. Consider adding `inputs` to the `test`/`typecheck` tasks in `turbo.json` — the stale-worktree cache replay is what let a failing suite report green.
2. **Close the three silent data-loss paths:** 3 (quit wipe), 4 (corrupt-state overwrite, with 14 as the same change), 7 (per-source watermark).
3. **Stop the runner from stalling permanently:** 6 and 8. Both are one-file changes.
4. **Decide the two auth questions:** 9 (revocation — trivial) and 10 (OIDC allowlist — needs an explicit decision about who the IdP admits).
5. **Then the correctness batch:** 5, 11, 20, 23 — each small and independently verifiable.
6. **Re-run the two blocked boundaries** (`scripts/**` + tooling/config, and the CSS/design-system contract). `purge-old-runs.mjs` deletes data and was never reviewed; `styles-contract.test.ts` is 2248 lines whose actual protective value is unknown.

## Appendix — validation results (current execution)

| Command | Result |
|---|---|
| `pnpm lint` | clean (exit 0) |
| `pnpm typecheck` | clean, 9/9 tasks (8 cached) |
| `pnpm exec turbo run typecheck --force` | clean, 9/9 tasks, 0 cached |
| `pnpm test` (cached) | green — but replaying logs recorded in `.worktrees/phase-e-quality-gate` |
| `pnpm exec turbo run test --force` | **1 failed** / 910 passed; `@alfred/desktop#test` fails |
| `pnpm exec vitest run src/renderer/app.test.tsx` ×5 | **5/5 failed**, all at `app.test.tsx:3275` |
| `pnpm --filter @alfred/desktop... build` | success |
| `pnpm smoke:electron` | **1 failed** / 14 passed (`e2e/inbox.spec.ts:175`) |
| `drizzle/**` vs `packages/db/src/schema.ts` | 16 tables, all columns, 30 index names, 9 enums — **no drift** |

Non-desktop suites all passed on the forced run: `@alfred/api` 64, `@alfred/runner` 73, `@alfred/schema` 31, `@alfred/adapters` 2, `@alfred/db` 1, plus 34 `node:test` script tests.
