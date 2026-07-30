# Phase S5 — Desktop Interaction Correctness

**Status:** Complete
**Parent:** `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`  
**Findings:** 5, 11, 17, 23

## Objective

Make Alfred's core desktop interactions recover from planning failures, make
blocked staged work genuinely editable, remove effects from React state
updaters, and classify file activity without false positives.

## Scope lineage

`Phase Z release closeout → post-v1 stabilization roadmap → S1–S5 complete → S6 next → S7 remains`

S5 closes only findings 5, 11, 17, and 23. It does not close the parent
stabilization roadmap.

## Classification and route

- **Decision:** settled. A blocked staged session of any agent kind uses the
  existing Review / Edit panel.
- **Diagnosis:** known cause, revalidated against `main` after S4.
- **Execution:** Medium/coordinated. The work crosses renderer state,
  main-process IPC, staged-plan persistence, and shared activity parsing.
- **Risk:** Elevated. Prepare Work is a primary workflow and several affected
  state updaters currently contain destructive or persistent effects.
- **Simplicity posture:** Lean. Reuse existing APIs, editor, preflight, status
  model, state refs, and tests. Do not add a reducer, state library, migration,
  compatibility path, or new error-code family.
- **Workflow after approval:** Planned. One implementation plan covers S5;
  independently testable tasks may be sequenced, but single-agent execution is
  the default.

## Current evidence

### Finding 5 — planning rejection strands the composer

`apps/desktop/src/renderer/app.tsx` sets Alfred to `thinking` and awaits
`requestPlan` without a `catch`. A rejected preload promise never reaches
either the `errored` or `idle` transition, so the composer remains disabled.

`apps/desktop/src/main/alfred-orchestrator.ts` resets its `inFlight` flag in a
`finally` block but does not catch exceptions from planning or preflight. The
IPC promise can therefore reject instead of returning `AlfredPlanResponse`.

### Finding 11 — Review / Edit is narrower than its producer

`attention-projection.ts` emits `review-edit` for every blocked staged session.
`AgentTimelinePanel.tsx` currently exposes the editor only for `shell` and
`dev-server`, leaving blocked Codex and Claude work with an action that cannot
resolve the blocker.

The existing `updateStagedPlanSession` path already validates the patch,
reruns `checkSafety`, reruns `preflightAlfredPlanSession`, and persists the
updated plan. No second editor or validation path is required.

### Finding 17 — state updaters still contain effects

S4 moved destructive Discard out of its state updater, but current renderer
handlers still perform some combination of nested React setters, IPC,
persistence, timers, ref mutations, `Date.now`, or ID generation from inside
functional state updaters. React may replay those callbacks, so correctness
must not depend on them running exactly once.

### Finding 23 — file activity regexes have incorrect precedence

`/\bupdated|modified\b/i` and `/\bwrote|written\b/i` bind the word boundary to
only one side of each alternation. Text such as `unmodified`, `overwritten`,
and `rewritten` can therefore be presented as a file operation.

## Accepted behavior

### 1. Prepare Work always reaches a terminal state

- Main-process `planRequest` catches unexpected planning and preflight
  exceptions, logs diagnostic context without secrets, and returns a
  non-success `AlfredPlanResponse`.
- The renderer also catches a rejected preload promise. This is a separate
  process-boundary guard, not a duplicate planning implementation.
- Every request ends in `idle` after success or `errored` after failure.
- After failure, the composer and submit action are enabled for a new attempt.
- A later successful attempt behaves exactly like the current successful path.
- The existing `in_flight` response remains unchanged.

Unexpected main-process failures use the existing `malformed` error code with
safe copy explaining that Alfred could not prepare the plan. A rejected
preload invocation uses the existing `network` code with retryable runtime
copy. No new shared error code is introduced.

### 2. Review / Edit works for every staged agent kind

- `codex`, `claude`, `shell`, and `dev-server` staged sessions use the existing
  editor and fields: `command`, `args`, and `cwd`.
- Running, restored, exited, and non-staged sessions do not gain editing.
- Saving continues through `updateStagedSession`; the main process validates
  the request, reruns safety checks and launch preflight, persists the plan,
  and returns the authoritative updated snapshot.
- A still-unsafe edit remains blocked with its refreshed reason.
- A safe edit clears the stale safety note or preflight blocker and becomes
  launchable.
- Save failure stays in edit mode and uses the existing inline error surface.
- The Inbox action remains Review / Edit; it no longer leads to a read-only
  dead end.

### 3. Functional state updaters are pure

For the S5-owned renderer paths, a functional React state updater may only
derive and return its next state. It must not:

- call desktop IPC or persistence;
- call another React setter;
- mutate a ref;
- create a timer;
- read `Date.now`;
- generate an ID.

Handlers read the current session or workspace from the existing refs or
captured event state, compute deterministic values before setters run, commit
the React states, and invoke each external effect once outside the updater.

This applies to every current S5 finding-17 call site in
`apps/desktop/src/renderer/app.tsx`, not only the previously destructive
Discard path. The current named scope is:

- fallback workspace creation in `handleBindWorkspaceFromFolder`;
- workspace rename and mission-brief persistence;
- collapse, select, focus, layout-preset, tile-move, and tile-resize
  persistence;
- restored-session continue and restart arming;
- runtime-ready attachment timestamps;
- staged-plan creation, pending-plan state, and persistence in
  `handleSubmitPrompt`.

The implementation plan must trace these handlers again against its exact
baseline before editing. A newly discovered sibling with the same root cause
inside `app.tsx` belongs to S5; unrelated renderer refactoring does not. The
work must remain local to existing handlers and helpers. S5 does not introduce
a global reducer or refactor unrelated rendering state.

Operation guards already used for close, worktree, and resume flows remain the
authority for stale async results and duplicate actions.

### 4. File activity classification uses complete words

The two expressions become complete-word alternatives:

- `\b(updated|modified)\b`
- `\b(wrote|written)\b`

Existing supported positive phrases continue to classify as file activity.
Embedded negatives such as `unmodified`, `overwritten`, and `rewritten` do not.
No broader parser or heuristic is added.

## Data and control flow

### Plan request

`composer → renderer handleSubmitPrompt → preload AlfredApi.requestPlan → main planRequest → LLM → preflight → structured response → renderer status`

Both process boundaries convert failure into a structured status. Only the
main process performs planning and preflight.

### Staged edit

`Inbox/Timeline Review / Edit → existing editor → updateStagedSession IPC → validate patch → checkSafety → preflight → persisted staged plan → renderer authoritative snapshot`

The renderer does not locally decide whether the edited command is safe.

### Pure state update

`event snapshot/ref → deterministic next values → React setters → guarded IPC/persistence`

No external effect is initiated while React is evaluating an updater callback.

## Verification

### Targeted regressions

1. Main `planRequest` converts a thrown planner or preflight error into a safe
   non-success response and releases `inFlight`.
2. Renderer request rejection produces `errored`, re-enables the composer, and
   permits a later successful request.
3. Blocked Codex and Claude staged sessions open the editor, save through the
   existing IPC, and render the refreshed preflight result.
4. Shell and dev-server editing remains green; non-staged sessions remain
   non-editable.
5. Representative StrictMode flows prove persistent/destructive IPC and other
   external effects occur exactly once.
6. Deterministic time and plan IDs are created outside replayable updaters.
7. Activity parsing retains positive matches and rejects `unmodified`,
   `overwritten`, and `rewritten`.

### Required gates

- focused main and renderer tests for planning failure and retry;
- focused Inbox/Timeline staged-edit tests;
- focused state-purity and IPC call-count tests;
- focused `session-activity` positive and negative tests;
- `pnpm --filter @alfred/desktop typecheck`;
- `pnpm --filter @alfred/desktop build`;
- full `pnpm verify`;
- focused review of the changed boundaries.

### Runtime observation

Use one direct Electron observation after implementation:

1. force a Prepare Work request to reject;
2. observe the visible error and enabled composer;
3. retry successfully;
4. open a blocked Codex staged session from Review / Edit;
5. change its command, args, or cwd and save;
6. observe the refreshed safety/preflight state.

The observation must use an isolated fixture and temporary user data. It must
not invoke the real runner against `~/.codex`.

## Closeout evidence

**Implementation commits:** `ef768cc`, `478ae96`, `3da82ed`, `5b98464`,
`d8283d2`, `628b7c8`

Closed behavior:

- rejected planning now returns or renders a structured failure, releases the
  in-flight guard, re-enables the composer, and permits a successful retry;
- blocked staged Codex and Claude sessions use the existing command editor,
  while the main process remains authoritative for safety and preflight;
- the S5-owned workspace, session, and plan state updaters derive state without
  nested setters, IPC, persistence, timers, ref mutation, time reads, or ID
  generation;
- file activity matches complete `updated|modified` and `wrote|written` words
  without classifying embedded negatives.

Fresh verification passed the requested desktop test command; because the
package forwarded the literal `--`, Vitest ran the full desktop suite (62/62
files and 992/992 tests). Desktop typecheck, desktop build, and full
`pnpm verify` also passed, including lint, typecheck 9/9, package and root
tests, build 6/6, and Electron smoke 16/16. Focused diff review found 0
Critical, 0 Important, and 0 Minor findings in the accepted S5 boundaries.

A direct Electron observation used a copied built application, temporary
`userData`, and temporary Codex and Claude homes. It forced one IPC request
rejection, observed the retryable error with an enabled composer, retried to a
two-session plan, edited a blocked Codex session into a launchable state, and
edited a second Codex session into a refreshed workspace-mismatch blocker.
The final UI showed `edited · rechecked`, the refreshed blocked reason, and a
disabled Launch action. The real runner and `~/.codex` were not used.

Final screenshot:
`.superpowers/sdd/2026-07-30-phase-s5-desktop-interaction-correctness/task-6-evidence/runtime.fujkF4/final-blocked-state.png`

Visual evidence: Observed — surface: Computer Use; proof: the completed final
`sky.get_app_state` showed the blocked workspace-mismatch state,
`edited · rechecked`, external cwd `/tmp/alfred-s5-outside-workspace`,
`Safety review required`, and the disabled `Blocked` launch action;
`nodeRepl.emitImage` then emitted the screenshot at the path above.

## Rollback and recovery

S5 changes no database, persisted-state schema, or migration. Before
integration, rollback is ordinary commit reversion. During implementation,
the work stays on an isolated branch/worktree. A failed gate blocks closeout;
there is no feature flag or compatibility layer.

## Out of scope

- visual redesign or new editor UI;
- a new reducer, state-management dependency, or broad `app.tsx` split;
- changes to runner ingest, API auth, database schema, or migrations;
- S6 findings 12, 20, and 21;
- S7 residue and portability follow-ups;
- changing worktree Apply, Review, Discard, or privacy behavior closed in S4;
- reclassifying activity beyond findings 23's two expressions.

## Completion contract

S5 is complete only when:

- findings 5, 11, 17, and 23 have targeted regressions;
- rejected planning no longer strands the composer;
- every staged agent kind can resolve a blocker through the existing editor;
- all current S5-owned functional state updaters are effect-free;
- activity classification rejects the accepted false-positive fixtures;
- focused gates, full `pnpm verify`, focused review, and direct Electron
  observation pass;
- the existing roadmap marks S5 Complete and names S6 as next without claiming
  the parent roadmap is complete.
