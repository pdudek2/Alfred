# Alfred Agent Space - Design

- Date: 2026-05-06
- Branch: main
- Status: draft, awaiting user review
- Author: brainstormed jointly with Patryk
- Scope of code: no implementation in this spec; implementation starts after repo audit and a separate plan

## 1. Summary

Alfred is moving from a web-first run reader and observatory toward a
desktop-first agent cockpit for Patryk's vibecoding workflow. The existing web
reader, API, runner, and observability work remain useful foundations, but the
main product surface becomes Alfred Agent Space: a local desktop app for
planning, launching, watching, and handoff-managing multiple coding agents and
utility terminals.

The core product promise is:

> Prompt Alfred for the squad you want, review the plan, then run real local
> terminal sessions in real workspaces.

Alfred must not trap work inside itself. Sessions are real local processes in
normal repositories, branches, and worktrees. Alfred tracks them, presents them,
and helps orchestrate them, but the user can continue the work from Ghostty,
Codex Desktop, Codex CLI, Claude, an IDE, or plain shell at any time.

## 2. Goals

- Build a desktop cockpit for managing multiple agent and terminal sessions in
  one place.
- Make Alfred an AI planning layer that can prepare a squad of Codex, Claude,
  dev server, watcher, reviewer, or utility sessions.
- Keep launch behavior plan-first: Alfred shows a SquadPlan before starting
  agent-created sessions.
- Support manual terminal workflows as first-class, without requiring Alfred to
  plan everything.
- Support macOS and Windows from the first desktop architecture pass.
- Keep existing Alfred web/API/runner work as reusable foundation instead of
  starting a separate product from scratch.
- Preserve normal Git and CLI escape hatches: worktrees, branches, cwd, resume
  commands, and external terminal handoff.
- Design the core in a way that can later power a mobile companion or cloud
  runner without binding all logic to Electron.

## 3. Non-goals

- No mobile app in v0.
- No cloud runners in v0.
- No multiplayer/team collaboration in v0.
- No full detach/reattach of live PTY sessions in v0.
- No marketplace of agent templates in v0.
- No automatic push, merge, force push, destructive cleanup, or hidden Git
  operations.
- No replacement of Codex Desktop internals.
- No immediate rewrite of the existing web reader, API, or runner.
- No separate repository at this stage.

## 4. Locked Decisions

| Decision | Value |
|---|---|
| Product direction | Alfred Agent Space, a desktop agent cockpit |
| Repository | Keep one Alfred monorepo |
| New app | Add `apps/desktop` when implementation begins |
| Terminal strategy | Embedded terminal first |
| Terminal UI | `xterm.js` |
| Terminal backend | `node-pty` |
| Desktop shell | Electron |
| Planner | OpenAI API based SquadPlan generator |
| Launch model | Plan-first for Alfred-created squads |
| Manual mode | First-class, no SquadPlan required |
| Isolation | Hybrid: coding agents get worktrees; shared utility sessions can run in main repo |
| Cross-platform | macOS and Windows from the start |
| Mobile | Future companion, not full local-terminal app |
| Handoff principle | Alfred tracks work, but does not own work |
| UI design | Separate UI design pass required before implementation plan |

## 5. Approaches Considered

### 5.1 Recommended: Electron with embedded terminals

Electron gives Alfred a browser-quality UI runtime, access to Node APIs, and a
straight path to xterm.js plus node-pty. It best matches the BridgeMind-style
experience Patryk likes: dense session grid, real terminals, browser/app
preview, workspace sidebar, and command layer in one app.

Trade-offs:

- Heavier than a pure web app or Tauri.
- Packaging and native dependency management need care.
- Runtime security boundaries must be explicit because the app can launch real
  local commands.

This is still the best v0 choice because the terminal cockpit is the product.

### 5.2 Rejected for v0: Ghostty-first hybrid

This would keep Ghostty as the primary terminal on macOS and use Windows
Terminal on Windows. It is simpler for early process launching but weaker as a
product: Alfred would become a launcher around external windows instead of a
coherent cockpit.

Trade-offs:

- Lower implementation risk at the very beginning.
- Worse cross-platform UX consistency.
- Harder to build a session grid, browser preview, unified status, and command
  layer.

Ghostty can remain an external handoff target, not the foundation.

### 5.3 Deferred: Pure web plus local bridge

This would keep the main UI in the browser and run a local daemon for terminals.
It could work for a future web companion, but it adds local networking, auth,
and daemon lifecycle concerns before the core product is proven.

Trade-offs:

- Better long-term web/mobile story.
- More moving pieces.
- Less natural for a local multi-terminal desktop cockpit.

The desktop app should come first; the core packages can later support a web or
mobile companion.

## 6. Product Experience

The first screen of desktop Alfred is a cockpit, not the observatory.

Primary layout:

- Left sidebar: workspaces/projects.
- Center: grid of terminal/session tiles.
- Right or docked panel: browser/app preview.
- Global command layer: Alfred prompt and plan/approval surfaces.
- Auxiliary panels: session history, observatory, run reader, logs, settings.

The user can type a request such as:

> Prepare 4 terminals: two Codex agents for the feature, one Claude reviewer,
> and one dev server.

Alfred returns a SquadPlan before launch. The plan shows:

- sessions to create;
- agent type for each session;
- working directory;
- branch/worktree choice;
- command to run;
- initial prompt or task;
- whether the session is isolated or shared;
- risk notes, especially shared files or dirty worktree state;
- expected success signal.

The user can approve, edit, or cancel the plan. After approval, Alfred creates
the sessions and shows status in the cockpit.

## 7. Architecture

The repository stays as one Alfred monorepo.

Proposed future structure:

```text
apps/
  desktop/       Electron shell, terminal grid, browser preview, IPC
  web/           Existing reader and observatory, later web companion surface
  api/           Existing local API and possible future backend surface

packages/
  core/          Shared types and domain contracts
  planner/       SquadPlan schema and OpenAI planner
  runtime/       Local process, PTY, Git worktree, branch, shell execution
  observability/ Run/session event normalization and summaries
```

Electron process boundaries:

- Renderer: React UI for workspace sidebar, terminal grid, browser preview,
  command layer, plan approval, and settings.
- Main process: window lifecycle, trusted native entry points, workspace
  registry, app-level settings.
- Runtime process or service: PTY sessions, process lifecycle, Git worktree
  operations, shell profiles, and session metadata writes.

The UI should never directly own process launching details. The UI asks the
runtime to launch an approved plan or manual terminal. The runtime validates the
request, performs preflight checks, starts processes, and streams status/output
back to the UI.

## 8. Core Domain Model

Minimum domain entities:

```ts
type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  defaultBranch?: string;
  platformHints?: {
    macShell?: string;
    windowsShell?: string;
  };
};

type SquadPlan = {
  id: string;
  workspaceId: string;
  goal: string;
  sessions: PlannedSession[];
  risks: PlanRisk[];
  createdAt: string;
};

type PlanRisk = {
  id: string;
  severity: "info" | "warning" | "blocker";
  message: string;
  affectedSessionIds?: string[];
};

type PlannedSession = {
  id: string;
  title: string;
  kind: "agent" | "utility" | "manual";
  agent?: "codex" | "claude";
  isolation: "worktree" | "main-workspace";
  cwd: string;
  branchName?: string;
  command: string;
  prompt?: string;
};

type Session = {
  id: string;
  workspaceId: string;
  title: string;
  kind: "agent" | "utility" | "manual";
  cwd: string;
  branchName?: string;
  command: string;
  status: SessionStatus;
  startedAt: string;
  lastActivityAt?: string;
  exitCode?: number;
};

type SessionStatus =
  | "starting"
  | "running"
  | "waiting"
  | "failed"
  | "exited"
  | "stale";
```

This model is intentionally small. It captures where work happened and what
Alfred launched without claiming ownership of Codex or Claude internal session
continuity.

## 9. Session and Data Flow

Alfred-led flow:

1. User prompts Alfred.
2. Planner generates a structured SquadPlan.
3. Runtime validates the plan shape and checks local feasibility.
4. User reviews and approves the plan.
5. Runtime creates worktrees/branches where needed.
6. Runtime starts PTY sessions.
7. Terminal output streams to the renderer.
8. Session status updates are persisted.
9. Reader/observatory/history panels can summarize the sessions later.

Manual flow:

1. User creates a terminal tile.
2. User chooses workspace/cwd and shell profile.
3. User types any command directly.
4. Runtime tracks cwd, command, output, activity, and exit status.
5. Alfred may later summarize or reason about the active workspace if asked.

Both flows are equal citizens. Alfred-led orchestration must not make manual
terminal work feel second-class.

## 10. Worktree and Handoff Model

Coding agent sessions should default to isolated worktrees and branches. Shared
sessions can run in the main workspace when appropriate.

Examples:

- Codex feature agent: `worktree`, new branch.
- Claude review agent: `worktree` by default; existing branch only when the
  user explicitly asks to review that branch in place.
- Dev server: `main-workspace`.
- Test watcher: `main-workspace` by default; worktree-local only when attached
  to a specific coding session.
- Plain manual shell: user chooses.

Every session should expose handoff actions:

- Open folder.
- Copy cwd.
- Copy command.
- Copy resume information if available.
- Open in external terminal where supported.
- Open in Codex or Claude where supported.

If a direct external open action is not available for a tool or platform, v0
falls back to copying the cwd and resume command/instructions.

Live PTY detach/reattach is deferred. The v0 handoff contract is simpler: the
work is in a normal directory and branch, and the tool-specific session history
belongs to that tool.

Product principle:

> Alfred is an orchestrator, not a prison.

## 11. Cross-Platform and Mobile

macOS and Windows are first-class for the desktop architecture.

Runtime rules:

- Abstract path operations, shell choice, quoting, and environment handling out
  of React components.
- macOS defaults to `zsh`.
- Windows defaults to PowerShell, with room for configurable shell profiles.
- Git worktree operations run through shared runtime functions with
  platform-aware tests.
- External-terminal handoff is optional and platform-specific.

Mobile is not a v0 terminal target. A future mobile Alfred should be a
companion:

- approve SquadPlans;
- inspect session status;
- stop/retry sessions;
- receive notifications;
- prompt Alfred remotely;
- review logs, summaries, and PR readiness;
- control cloud or desktop-hosted runners later.

The design implication is that domain logic belongs in shared packages, not in
Electron-only UI code.

## 12. Safety, Privacy, and Control

Alfred will launch real local commands, so the control model must be explicit.

Rules:

- Alfred-created squads always show a plan before launch.
- Commands generated by Alfred are visible before they run.
- Worktree and branch creation is visible before it happens.
- Manual terminal sessions do not require a plan because the user is typing the
  command directly.
- Destructive Git actions require separate confirmation.
- Force push is not part of v0.
- Runtime validates planner output before doing local work.
- Secrets, `.env` files, OAuth data, and raw private prompt archives are not
  sent to the planner.
- Session tiles always show cwd, branch if any, and isolation mode.
- OpenAI failures do not block manual terminal use.

The planner can help prepare work, but the runtime is the authority for what is
allowed to execute.

## 13. Error Handling

Failures should be local to the session or action that failed.

Expected handling:

- Invalid SquadPlan: show validation error, launch nothing.
- OpenAI API failure: show planner error, keep manual mode usable.
- Missing `codex` or `claude`: mark that planned session as blocked, do not
  block unrelated manual terminals.
- Dirty workspace before worktree creation: show preflight warning and require
  user choice.
- Existing branch/worktree name collision: propose a safe alternate name.
- PTY start failure: session tile shows failed state and logs the error.
- Process exit: tile moves to exited with exit code.
- Renderer crash must not corrupt persisted session metadata. If v0 cannot
  reconnect to live PTY processes after restart, affected sessions are shown as
  stale with their last known cwd, branch, command, and timestamps.

## 14. V0 Scope

Included in v0:

- Electron desktop shell.
- Workspace registry.
- Manual terminal grid.
- Embedded terminal via xterm.js and node-pty.
- Alfred command box.
- SquadPlan schema and approval screen.
- Mock planner first, then OpenAI planner.
- Runtime launch of approved plans.
- Git worktree/branch creation for coding sessions.
- Shared/main sessions for dev servers and watchers.
- Basic session statuses.
- Minimal browser/app preview panel.
- Minimal session history.
- Handoff actions.

Deferred beyond v0:

- Mobile app.
- Cloud runners.
- Multiplayer collaboration.
- Live PTY detach/reattach.
- Advanced agent templates.
- Full observability analytics.
- Automatic PR push/merge.
- Packaging polish beyond what is needed for local dogfooding.

## 15. Testing Strategy

Required test layers:

- Unit tests for SquadPlan schema, status derivation, and session metadata.
- Runtime tests using temporary repositories and temporary worktrees.
- PTY tests using simple commands instead of real Codex or Claude.
- Platform-aware tests for shell selection and path handling.
- UI tests for manual terminal creation, plan approval, and session grid state.
- Browser/Electron smoke tests for terminal rendering, resizing, focus, and
  output streaming.
- Existing full checks when shared packages are touched: `pnpm test`,
  `pnpm typecheck`, and `pnpm build`.

Runner rule remains unchanged: do not run the real Alfred runner against
`~/.codex` unless the task is explicitly runner ingestion work.

## 16. UI Design Gate

This document defines product direction and technical architecture. It does not
finalize the detailed UI.

Before implementation planning, Alfred Agent Space needs a separate UI design
pass and written UI spec. That pass should use visual mockups and cover:

- first-screen layout and density;
- workspace sidebar behavior;
- terminal tile anatomy;
- terminal grid resizing and focus;
- Alfred command layer placement and states;
- SquadPlan review and edit screen;
- browser/app preview placement;
- manual terminal creation flow;
- session status visuals;
- keyboard shortcuts;
- empty, loading, failed, waiting, and stale states;
- relationship between the new desktop cockpit and the existing Alfred visual
  language.

The UI pass should compare at least two directions:

- BridgeMind-like dense cockpit;
- calmer Alfred chief-of-staff cockpit;
- a hybrid that keeps the dense terminal grid but gives Alfred's command layer
  more calm and hierarchy.

No desktop scaffold should start until the UI spec is approved.

## 17. Rollout Plan

Implementation should happen in small PRs after this product/architecture design
is reviewed, the repo readiness audit is complete, the UI design is approved,
and an implementation plan is written.

Recommended sequence:

1. Repo readiness audit.
2. UI design pass with visual mockups and a written UI spec.
3. Implementation plan.
4. Shared core type extraction or creation.
5. Desktop app scaffold.
6. Manual terminal grid.
7. Workspace registry.
8. SquadPlan schema and mock planner.
9. Plan approval UI.
10. OpenAI planner.
11. Runtime launch from approved plan.
12. Worktree/branch creation.
13. Browser/app preview.
14. Observatory/history panel integration.

The first engineering step is not scaffolding. It is the repo readiness audit.

## 18. Repo Readiness Audit Scope

Before adding `apps/desktop`, inspect the repository for:

- package boundaries and whether shared logic already exists;
- web/API code that should move into shared packages;
- stale branches, worktrees, or docs that could confuse the desktop work;
- dependency and lockfile risk;
- test setup assumptions tied only to `apps/web`;
- global styles or product language that should not leak into desktop;
- runner/API assumptions that would make desktop status misleading;
- naming drift between runs, sessions, agents, and runner concepts;
- places where observatory/reader code is too coupled to be reused.

The audit should produce a short written recommendation before implementation
starts.

## 19. References

- xterm.js documentation: https://xtermjs.org/docs/
- xterm.js repository: https://github.com/xtermjs/xterm.js/
- node-pty repository: https://github.com/microsoft/node-pty/
- Electron utilityProcess documentation: https://www.electronjs.org/docs/latest/api/utility-process
