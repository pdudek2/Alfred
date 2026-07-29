# Phase S4 — Privacy and Worktree Lifecycle

**Status:** Complete
**Roadmap:** `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`
**Source audit:** `docs/audits/2026-07-29-agent-sanity-review.md`
**Findings:** 13, 15, 16

## Objective

Make terminal close behavior non-destructive for isolated work, and make the
desktop privacy controls truthful: closing a live isolated session must retain
its checkout for recovery, while retention Off and Clear saved terminal data
must remove sensitive launch data rather than only clearing scrollback.

## Routing

- **Decision:** settled by product review.
- **Diagnosis:** known cause in the terminal lifecycle, desktop-state
  normalization, privacy clear handler, and shared redactor.
- **Execution:** large enough for a dedicated implementation plan, but confined
  to S4.
- **Risk:** elevated because the phase changes persisted state and protects
  against both secret leakage and worktree loss.
- **Simplicity posture:** lean. Reuse the existing Recovery surface, worktree
  inspection/apply/discard flow, workspace registry, and desktop-state store.
  Do not add a second persistence system, encryption, Keychain integration, or
  a compatibility layer.

## Accepted product decisions

1. Closing a live isolated session stops its process but retains its persisted
   recovery record, branch, and worktree.
2. Worktree deletion remains a separate explicit Discard action guarded by the
   existing change inspection and destructive confirmation.
3. Retention Off and Clear saved terminal data are privacy-first operations.
   They remove launch instructions and raw paths even though exact relaunch is
   no longer possible.
4. A retained isolated checkout may keep only the safe identifiers required to
   find it again.
5. Existing valid state is sanitized automatically on first read/write and
   atomically replaces the old file. Migration does not create a backup
   containing the old launch data.

## Non-goals

- Encrypting terminal launch data or introducing a private launch vault.
- Adding Keychain support.
- Preserving exact relaunch after launch data has been cleared.
- Redesigning the Recovery surface.
- Changing shared-session close behavior beyond making it consistent with the
  selected privacy policy.
- Reworking the workspace registry or removing its required project root.
- Broad persistence, terminal, or Git-worktree refactors.

## Current failure modes

### Live close forgets the only recovery record

The renderer kills a live terminal without requesting worktree cleanup.
`terminal-manager.ts` nevertheless calls the kill path with
`forgetSnapshot: true`. The process stops, the worktree and branch remain on
disk, and the persisted metadata needed to review or clean them disappears.

### Privacy controls clear only presentation data

The persistence path redacts the title, buffer, and activity payloads, but
retains `command`, `args`, `cwd`, `baseCwd`, `shell`, `resumeTarget`, and
`branchName`. Retention Off and Clear saved terminal data remove buffer and
activity only, so commands, prompts encoded in arguments, resume identifiers,
and absolute local paths remain in `desktop-state.json`.

### The shared redactor misses common credential forms

The current redactor does not cover URI userinfo credentials, several common
provider token prefixes, JSON API-key assignments, or the complete value of a
Cookie header.

## Design

### 1. One persisted record, two capability levels

Keep the existing persisted terminal-session collection. Do not add a second
store or a new persisted state machine.

A persisted record always contains the minimum identity and display metadata
that remains safe:

- `clientId`;
- redacted `title`;
- `source` and optional `agentKind`;
- optional `workspaceId`;
- optional opaque `workspaceRootFingerprint`;
- optional `isolation`;
- optional validated Alfred-managed `branchName`;
- optional `createdAt`.

Launch and transcript fields become optional persisted capabilities:

- `cwd`;
- `baseCwd`;
- `shell`;
- `command`;
- `args`;
- `resumeTarget`;
- `buffer`;
- activity events and activity timestamps.

The absence of launch fields is the state marker. No additional
`privacyCleared`, `recoveryOnly`, or schema-mode flag is introduced.

A record is relaunch-capable only when its existing source-specific launch
requirements are complete. A record is worktree-recoverable when it has an
isolated-worktree identity (`workspaceId`, an opaque root fingerprint,
validated `branchName`, and worktree isolation). These capabilities are
derived, not stored as parallel booleans.

### 2. Close and Discard semantics

For a live session:

1. Close stops the PTY.
2. The latest snapshot is retained unless the user selected an explicit
   destructive cleanup action.
3. Persistence immediately applies the current privacy policy to that
   snapshot.

For an isolated session, the retained snapshot continues to appear in the
existing Recovery surface after Close and after an application restart.

Discard remains separate:

1. Inspect the isolated checkout using the existing worktree-diff path.
2. If changes exist, show the existing destructive confirmation with Review
   and permanent Discard actions.
3. Only confirmed Discard removes the worktree and branch and then forgets the
   recovery record.
4. A cleanup failure must leave the recovery record intact and surface the
   error; metadata must not disappear before cleanup succeeds.

For a shared session there is no checkout to recover. With retention Off, Close
does not retain a useless recovery-only record.

### 3. Privacy sanitizer as the single policy boundary

Use one shared sanitizer for persisted terminal snapshots. It is called by:

- normal terminal snapshot persistence;
- desktop-state normalization and legacy migration;
- the retention-setting update path;
- Clear saved terminal data.

With `redactedTail`, the sanitizer keeps the currently supported relaunch
fields. It applies the shared secret redactor to user-authored launch text and
transcript values. Structural `cwd`, `baseCwd`, and `shell` paths remain
verbatim only while retention is enabled because they are required by the
current relaunch contract; Off and Clear remove them.

With retention Off, or when Clear saved terminal data is invoked, the
sanitizer removes:

- `cwd` and `baseCwd`;
- `shell`;
- `command` and `args`;
- `resumeTarget`;
- `buffer`;
- activity events, `lastActivityAt`, and `lastOutputAt`.

It preserves an isolated record only when it has the safe worktree-recovery
identity. Non-isolated records without resumable data are removed.

Clear saved terminal data applies the same policy to both the in-memory
restored-session map and the persisted desktop state before returning success.
Changing retention to Off also sanitizes existing records immediately; it is
not only a policy change for future writes.

### 4. Resolve worktree operations from the workspace registry

Raw `baseCwd` and worktree `cwd` are no longer required in a sanitized recovery
record.

The main process resolves the base project root at action time:

1. Read the current workspace registry using `workspaceId`.
2. Require an available `rootPath`.
3. Compare an opaque fingerprint of the resolved root with the fingerprint
   stored when the isolated checkout was created.
4. Combine the verified root with the validated `branchName` and the existing
   managed worktree-root rules.
5. Pass the resolved request through the existing
   `isSafeAgentWorktreeCleanupRequest` guard before inspect, apply, or cleanup.

`registerTerminalIpc` receives the smallest resolver it needs from the existing
workspace store. It does not receive a duplicate workspace cache.

If the workspace is missing, unbound, or rebound to a root with a different
fingerprint, Alfred keeps the recovery item and returns a precise
reattach-the-original-project error. It does not guess a path and does not
delete anything.

If the workspace is available but the branch/worktree is already absent,
Alfred may forget the stale recovery record without claiming to have deleted
the checkout.

The workspace root remains product data in the workspace registry. S4 removes
duplicate raw paths from terminal launch records; it does not make Alfred
project-blind.

### 5. Recovery UI behavior

Reuse the current Recovery list, review surface, worktree review/apply actions,
and Discard dialog.

- A relaunch-capable record keeps its current Resume action.
- A sanitized isolated record does not show Resume.
- It offers the existing Review changes, Apply to Work, and Discard checkout
  actions.
- It shows one short explanation:
  `Launch details were cleared for privacy. Your isolated checkout is still available.`
- A shared record removed by retention Off or Clear does not appear in
  Recovery.
- A missing workspace disables unsafe worktree actions and explains that the
  project must be reattached first.

No new page, modal family, card hierarchy, or settings surface is added.

### 6. Automatic migration

Desktop-state normalization accepts both the current full snapshots and the
new optional launch fields.

On the first successful state read:

1. Normalize the parsed state.
2. Apply the current privacy policy through the shared sanitizer.
3. Detect whether the normalized file differs from the parsed valid file.
4. Atomically replace the state file when migration changed it.
5. Continue with the sanitized in-memory state only after the replacement
   succeeds.

The valid legacy file is overwritten, not copied or quarantined. Existing
invalid/corrupt-file recovery behavior is outside S4 and remains unchanged.

Migration is idempotent. A second read produces no additional changes or
writes.

### 7. Shared secret redaction

Extend `packages/schema/src/redactor.ts`; do not add a terminal-only redactor.
All current callers benefit from the same fixes.

Add coverage for:

- URI userinfo credentials such as `https://user:password@example.com`;
- Stripe live secret keys beginning with `sk_live_`;
- Google API keys beginning with `AIza`;
- GitLab personal access tokens beginning with `glpat-`;
- npm access tokens beginning with `npm_`;
- SendGrid keys beginning with `SG.`;
- JSON/string assignments such as `"api_key": "secret"`;
- the complete Cookie header value, including segments after semicolons.

Every new secret fixture has a nearby non-secret control fixture to prevent
obvious overmatching. Diagnostics and assertion messages must not echo the
original secret.

## Failure handling

- A failed privacy migration is a persistence failure. Alfred must not report
  the state as safely migrated while continuing from an unsanitized disk file.
- A failed clear operation returns failure and keeps the save-failure status
  visible through the existing desktop-state mechanism.
- A failed PTY stop must not trigger worktree cleanup.
- A failed worktree inspect/apply/discard action leaves the recovery record
  available for retry.
- Missing launch fields produce an unavailable Resume capability, not a
  malformed launch request.
- Missing workspace binding produces a recoverable user-facing error, not a
  fallback to an untrusted path.

## Verification

### Focused automated checks

1. Live isolated Close stops the PTY, retains the snapshot, and does not call
   worktree cleanup.
2. Confirmed Discard inspects changes, removes the worktree/branch, and forgets
   the record only after successful cleanup.
3. Cleanup failure retains the record.
4. Retention Off strips every launch/transcript field and retains only a valid
   isolated recovery identity.
5. Retention Off removes shared records that have no recovery capability.
6. Clear saved terminal data applies the same sanitizer in memory and on disk.
7. Switching retention to Off sanitizes already persisted records immediately.
8. Legacy valid state is rewritten once, contains no cleared fields, and is
   idempotent on the next read.
9. `workspaceId + workspaceRootFingerprint + branchName` resolves Review,
   Apply, and Discard after restart without persisted `cwd` or `baseCwd`.
10. Missing/rebound workspace, fingerprint mismatch, and already-absent
    worktree paths fail safely.
11. Every added credential fixture is redacted and every paired ordinary-text
    fixture remains readable.
12. A sanitized Recovery item omits Resume, preserves worktree actions, and
    exposes the privacy explanation accessibly.

### Fresh project gates

- focused desktop, renderer, persistence, worktree, and schema redactor tests;
- `pnpm --filter @alfred/desktop typecheck`;
- `pnpm --filter @alfred/desktop build`;
- the relevant schema package tests and typecheck;
- full `pnpm test`;
- full `pnpm typecheck`;
- full `pnpm build`;
- `pnpm verify` before closeout.

### Manual macOS observation

Using a fixture or temporary workspace, never the real runner home:

1. Launch an isolated agent session.
2. Modify a tracked or untracked file in its worktree.
3. Close the live session.
4. Restart Alfred.
5. Confirm the session appears in Recovery.
6. Confirm Review lists the change.
7. Exercise Apply to Work in one run and confirmed Discard in another.
8. Repeat with retention Off or after Clear and confirm that Resume is absent,
   worktree recovery remains available, and the persisted state contains none
   of the cleared launch fields.

## Completion contract

S4 is complete only when:

- findings 13, 15, and 16 have targeted regressions;
- live Close cannot orphan a worktree by forgetting its metadata;
- Off/Clear remove sensitive launch data from memory and disk;
- automatic migration has a verified no-backup, idempotent rewrite path;
- sanitized Recovery remains usable through the workspace registry;
- all fresh gates and the manual macOS observation pass;
- focused review finds no unrelated visual, API, database, dependency, or
  broad persistence refactor.

S5 planning does not begin until S4 receives fresh verification and a roadmap
closeout.

## Closeout

**State:** Complete

**Implementation commits:** `47ce4fa`, `591c865`, `66329fb`, `006385e`,
`1b13861`, `f73ae07`, `279d9af`, `b192291`, `aad5063`, `fa7cf19`, `d5556eb`,
`676cb15`, `2a29706`, `54067ff`, `4885ff1`

**Next phase:** S5 — Desktop interaction correctness; unplanned until a new
convergence workflow begins

Closed behavior:

- live isolated Close stops the terminal while retaining the recovery record,
  branch, and checkout;
- Review, Apply, and explicit permanent Discard remain available after restart,
  including when macOS resolves the same workspace through `/var` and
  `/private/var` aliases;
- Discard awaits authoritative root resolution, fingerprint validation,
  guarded cleanup, and persistence before the renderer removes the tile;
- retention Off and Clear remove launch, resume, path, transcript, and activity
  fields from memory and disk while preserving only safe checkout identity;
- valid legacy state is sanitized through the single canonical sanitizer;
- the shared schema redactor covers the accepted credential forms.

Fresh verification at `54067ff`:

- schema: 47/47 tests, typecheck passed, build passed;
- desktop: 962/962 tests, typecheck passed, build passed;
- full `pnpm test`: 34/34 root script tests and all six package test tasks
  passed, 1,174 tests total;
- full `pnpm typecheck`: 9/9 tasks passed;
- full `pnpm build`: 6/6 tasks passed;
- `pnpm verify`: lint, typecheck, tests, build, and Electron smoke 16/16
  passed.

Final review follow-up at `4885ff1` closed the remaining hydration,
cleanup-before-forget, stale Discard preflight, complete Cookie redaction, and
secret-safe diagnostic gaps. Fresh focused verification passed schema 43/43
and desktop 330/330 tests. Full `pnpm verify` passed 1,187/1,187 automated
tests, typecheck 9/9, build 6/6, and Electron smoke 16/16. The independent
scoped re-review reported 0 Critical, 0 Important, and 0 Minor findings and
approved the fix wave.

The complete macOS observation used disposable repository
`/var/folders/gr/v03n0xbx0js1jnb6w8rzd0280000gn/T/alfred-electron-PIqdbC`,
its isolated user-data directory, and a copied Electron application. Separate
cycles proved Apply and permanent Discard for tracked and untracked changes.
Under retention Off, restart produced a recovery-only record containing safe
identity only; a recursive scan found none of `cwd`, `baseCwd`, `shell`,
`command`, `args`, `resumeTarget`, `buffer`, `activityEvents`,
`lastActivityAt`, or `lastOutputAt`. Review still listed both changes, and
permanent Discard removed the record, worktree, and branch while leaving the
base repository clean.

Focused review found no API, database, runner, dependency, lockfile, migration,
or broad visual change; no duplicate sanitizer; cleanup-before-forget ordering;
and generation coverage preventing cleared data from being repersisted by a
live session. Finding 17 remains routed to S5 except for the destructive
close/discard updater path required by S4.

Three non-blocking follow-ups remain explicitly routed: store retry-intent
consistency after a post-cleanup flush failure and Windows junction coverage to
S7, and transport-level preload rejection normalization to S5. They do not
weaken the verified S4 privacy or no-work-loss invariants.
