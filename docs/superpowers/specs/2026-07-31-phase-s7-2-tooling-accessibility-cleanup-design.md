# Phase S7.2 — Tooling and Accessibility Cleanup

**Status:** Complete
**Date:** 2026-07-31
**Owner:** `main`
**Parent:** `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

## Summary

S7.2 closes the remaining bounded tooling and accessibility residue from the
S7 audit. It removes a one-off parallel-agent launcher whose embedded tasks are
already complete, adds hermetic process coverage for the read-only development
doctor, replaces unsupported tab semantics in the project navigator with an
honest navigation-list contract, and runs the filesystem-alias regression
against a real Windows directory junction in CI.

The phase does not add a product feature or change Alfred's accepted visual
language. It makes existing maintenance and navigation behavior easier to
trust, test, and operate.

## Problem

Four small but durable gaps remain after S7.1:

1. `scripts/launch-parallel-agents.mjs` still exposes completed 2026-07 tasks
   as if they were reusable commands; running it can create obsolete branches,
   worktrees, and agent prompts. Its monitor exists only for those worktrees.
2. `scripts/dev-doctor.mjs` is useful and read-only, but the repository has no
   automated proof of its healthy or actionable-failure output.
3. `ProjectNavigator` declares a `tablist` and `tab` controls without a
   `tabpanel` or `aria-controls`, even though the surface is a hierarchical
   navigation list.
4. Canonical-path tests cover directory symlinks but never execute the same
   escape attempt through a Windows directory junction.

Leaving these in place makes stale automation look supported, leaves a key
operator diagnostic outside the quality gate, communicates the wrong widget
model to assistive technology, and claims cross-platform alias safety without
running the Windows-specific primitive.

## Goals

- Delete the stale parallel-agent launcher, its dedicated monitor, and their
  root package scripts.
- Prove `dev-doctor` success and failure behavior through a hermetic spawned
  process without Docker, Postgres, the real runner, or live application
  services.
- Represent projects as an ordinary labelled list inside the existing
  navigation landmark.
- Preserve project arrow-key shortcuts while making every project destination
  an ordinary Tab-reachable button.
- Expose the current workspace and current session with honest `aria-current`
  values rather than tab selection state.
- Exercise canonical-path escape rejection with a real directory junction on
  `windows-latest` CI.
- Keep focused and full repository gates green.

## Non-goals

- No redesign of the project rail, terminal grid, Preview, Sessions, Context,
  Inbox, or command palette.
- No broad CSS or design-token cleanup and no change to the accepted glass
  treatment.
- No new agent orchestration framework or replacement launcher.
- No change to runner ingestion, device authentication, browser surfaces, API
  routes, database schema, migrations, dependencies, or `pnpm-lock.yaml`.
- No production behavior change in `dev-doctor` unless its new process tests
  expose a concrete defect.
- No general filesystem abstraction or mocked reimplementation of `realpath`.
- No claim that Alfred ships a supported Windows desktop build; the Windows
  job validates only the platform-specific junction security contract.

## Product and technical decisions

### 1. Delete the stale launcher instead of generalizing it

The launcher contains six hard-coded tasks whose underlying work already
exists in the repository. No runtime, CI workflow, documentation entry, or
other script consumes it or its monitor; only `agent:launch` and
`agent:monitor` expose them from `package.json`.

S7.2 deletes both scripts and both package entries. It does not replace them
with a configurable task format. Current Codex/Claude task coordination is
owned by the active agent workflow, not by permanent repository scaffolding
for a single historical batch.

### 2. Characterize `dev-doctor` at the process boundary

`dev-doctor` already has the correct responsibility: inspect the repository,
Docker/Postgres, API, runner process, and desktop renderer without mutating
state. The smallest durable test is a spawned-process harness that places
temporary `pnpm`, `docker`, and `ps` executables at the front of `PATH`, then
uses local HTTP and TCP fixtures for the remaining probes.

The harness proves:

- a fully healthy fixture exits `0`, reports every check as `PASS`, and prints
  a zero-failure summary;
- an unhealthy fixture exits `1`, prints `FAIL` lines with recovery actions,
  and still completes the remaining independent checks.

This keeps production code free of dependency-injection seams added only for
tests. If the characterization exposes a real discrepancy, the implementation
fix remains local to `scripts/dev-doctor.mjs` and is pinned by the same test.

### 3. Use navigation-list semantics, not tabs

The project rail remains a navigation landmark. Its project collection becomes
a labelled `list`, and every project section becomes a `listitem`. Project
buttons return to their native button role and normal Tab order.

The active project uses `aria-current="location"`; the active nested session
uses `aria-current="page"`. Existing Arrow, Home, and End handling remains as
an additional keyboard shortcut and continues to move focus and selection.
There is no `tablist`, `tab`, `aria-selected`, roving `tabIndex`, synthetic
`tabpanel`, or visual/CSS change.

### 4. Test the actual Windows junction primitive

The existing canonicalization remains the source of truth. The regression
creates an allowed root, an outside directory, and a directory alias pointing
outside. On Windows it creates the alias with `type: "junction"`; elsewhere it
uses `type: "dir"` so the same test stays active in the normal suite.

A narrow `windows-latest` CI job installs the existing dependencies and runs
only `workspace-path.test.ts`. This gives the junction branch a real gate
without duplicating the full Ubuntu quality or macOS Electron jobs.

## User stories

- As a maintainer, I want repository commands to represent current workflows
  so that I do not create obsolete worktrees by following a stale script.
- As a developer, I want `dev-doctor` failures to be predictable and
  actionable so that local setup problems can be diagnosed without mutation.
- As a keyboard or screen-reader user, I want the project rail to announce
  itself as navigation rather than an incomplete tab widget.
- As a maintainer of path-security behavior, I want Windows junction escapes
  exercised on Windows so that canonical-root checks are not inferred only
  from POSIX symlinks.

## Acceptance criteria

1. `agent:launch`, `agent:monitor`, `launch-parallel-agents.mjs`, and
   `monitor-parallel-agents.mjs` are absent, with no non-historical caller left.
2. A controlled healthy `dev-doctor` process exits `0` and reports zero failed
   checks.
3. A controlled unhealthy `dev-doctor` process exits `1`, includes actionable
   recovery copy, and does not stop after the first failed dependency.
4. `ProjectNavigator` exposes one `navigation` landmark and one labelled
   project `list`; it exposes no `tablist` or `tab` role.
5. Every visible project button is Tab-reachable. Arrow, Home, and End still
   select and focus their target.
6. The active workspace has `aria-current="location"`; the active session has
   `aria-current="page"`.
7. Existing project-shell and workspace-switch Electron scenarios use the new
   semantic contract and remain green without a screenshot/CSS change.
8. The filesystem-alias test uses a real junction on Windows and rejects an
   outside target.
9. A Windows CI job runs the focused path test; Ubuntu quality and macOS
   Electron gates remain unchanged.
10. Focused tests, `pnpm test:scripts`, desktop typecheck/build, and full
    `pnpm verify` pass.

## Validation and rollout

- Script tests use temporary executables, local loopback servers, and temporary
  directories only.
- The real Docker daemon, Postgres data, runner, `~/.codex`, and external
  services are not used by automated tests.
- Renderer unit tests assert the accessibility tree and keyboard behavior.
- Existing real-Electron project-shell/workspace-switch scenarios assert the
  renamed roles and current-state attributes.
- Windows CI runs only the path-security test; normal release gates keep their
  current platforms.
- Rollout is the normal repository/desktop release path. No migration, feature
  flag, or user setting is required.

## Risks

- Removing the launcher can surprise someone relying on the undocumented
  command. Repository-wide search found no consumer beyond its own package
  scripts, and the encoded tasks are already complete; Git history preserves
  the file if it is ever needed for archaeology.
- A process fixture can accidentally test its stubs more than the script. The
  harness therefore spawns the real `dev-doctor.mjs` and asserts final output
  and exit status rather than importing copied logic.
- Changing ARIA roles can break role-based unit and Electron selectors. Those
  selectors are part of the same task and become the runtime proof of the new
  contract.
- Windows package installation adds CI time. The job remains narrow and does
  not run the desktop build or Electron smoke.

## Success metrics

| Metric | Target | Measurement |
|---|---:|---|
| Stale launcher surfaces | 0 | repository residue scan |
| Hermetic `dev-doctor` scenarios | 2/2 green | `node:test` process tests |
| Unsupported navigator tab roles | 0 | renderer and Electron assertions |
| Visible project buttons in native Tab order | 100% | renderer keyboard test |
| Windows junction escape rejection | 100% in regression | `windows-latest` focused job |
| New dependencies/schema/visual changes | 0 | scoped diff review |

## Open questions

None. The four residue decisions are bounded and approved. Any defect exposed
by the `dev-doctor` characterization that requires a broader product or service
contract change must return to convergence instead of silently expanding S7.2.

## Closeout

**State:** Complete

**Implementation commits:** `2f8c60b`, `8f75cf5`, `7a6e796`, `96d17c6`,
`b82fe45`, `32e949c`, `463346a`, `fd7f208`, `ab2af24`, `c7e326d`

Closed behavior:

- the obsolete parallel-agent launcher, monitor, and package commands are gone;
- `dev-doctor` has hermetic healthy and actionable-failure process coverage;
- project navigation uses list/button semantics, native Tab order, and honest
  `aria-current` state while preserving Arrow, Home, and End shortcuts;
- the canonical-path escape regression runs against a native Windows junction;
- terminal identity and collapse tests no longer depend on the CI host shell,
  installed agent binaries, or unsettled StrictMode cleanup.

Fresh local verification passed `TURBO_FORCE=true pnpm verify`: script tests
37/37, desktop tests 1017/1017, typecheck 9/9 tasks, build 6/6 tasks, and
Electron smoke 18/18 with no cached Turbo task reuse. Focused review reported
0 Critical, 0 Important, and 0 Minor findings.

Remote CI run `30672423698` passed all three required jobs at `c7e326d`:

- `quality` — job `91292740112`;
- `electron-smoke` — job `91292740133`;
- `windows-path-security` — job `91292740082`, exercising the native junction
  branch on `windows-latest`.

No dependency, lockfile, schema, migration, browser/auth, runner, API, broad
CSS, accepted copy, layout, or visual-output change entered S7.2. Normal Git
integration is the only remaining repository action; no further product phase
is planned by this roadmap.
