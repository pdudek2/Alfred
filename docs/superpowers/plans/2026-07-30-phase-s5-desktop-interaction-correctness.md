# Phase S5 — Desktop Interaction Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Prepare Work recover from process-boundary failures, let every blocked staged agent use the existing editor, remove effects from the remaining S5-owned React state updaters, and stop embedded words from being reported as file activity.

**Architecture:** Keep the current renderer, IPC contracts, staged-plan store, editor, state helpers, and persistence APIs. Convert failures to existing structured responses at both process boundaries, compute state transitions before invoking React setters, then perform each external effect once outside replayable updater callbacks.

**Tech Stack:** Electron IPC, TypeScript, React, Vitest, Testing Library, existing Alfred planning/preflight and staged-plan APIs.

## Global Constraints

- Implement only findings 5, 11, 17, and 23 from the post-v1 stabilization roadmap.
- The accepted contract is `docs/superpowers/specs/2026-07-30-phase-s5-desktop-interaction-correctness-design.md`.
- Reuse `AlfredPlanResponse`, the existing `malformed` and `network` codes, `AgentTimelinePanel` editor, `updateStagedSession`, safety checks, launch preflight, workspace/layout APIs, and current state helpers.
- Do not add a reducer, state-management dependency, error-code family, editor, modal, migration, compatibility path, or visual redesign.
- Functional React state updaters may only derive and return state. They must not call IPC/persistence, another setter, timers, ref mutations, `Date.now`, or ID generation.
- Retain current operation guards and stale-result checks for close, worktree, resume, and staged-plan flows.
- Do not modify `pnpm-lock.yaml`, database schema/migrations, API auth, runner ingestion, or broad global styles.
- Never run the real runner against `~/.codex`; use fixtures and temporary `ALFRED_CODEX_HOME`/user-data paths.
- Never force-push or add AI co-author trailers.
- Do not push without Patryk's explicit authorization for the implementation session.

## File Map

- `apps/desktop/src/main/alfred-orchestrator.ts` — convert unexpected planner/preflight exceptions to a safe `AlfredPlanResponse`.
- `apps/desktop/src/main/alfred-orchestrator.test.ts` — IPC registration, structured failure, and `inFlight` release regressions.
- `apps/desktop/src/renderer/app.tsx` — renderer rejection recovery and effect-free S5 state transitions.
- `apps/desktop/src/renderer/app.test.tsx` — retry, authoritative staged editing, StrictMode, and exactly-once persistence regressions.
- `apps/desktop/src/renderer/components/AgentTimelinePanel.tsx` — expose the existing staged editor for all staged agent kinds.
- `apps/desktop/src/renderer/components/AgentTimelinePanel.test.tsx` — Codex/Claude editing and non-staged read-only regressions.
- `apps/desktop/src/shared/session-activity.ts` — correct the two alternation boundaries.
- `apps/desktop/src/shared/session-activity.test.ts` — supported positives and embedded-word negatives.
- `docs/superpowers/specs/2026-07-30-phase-s5-desktop-interaction-correctness-design.md` — final S5 status and evidence.
- `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md` — mark S5 complete and route next work to S6.

---

### Task 1: Make planning failure terminal and retryable

**Files:**
- Create: `apps/desktop/src/main/alfred-orchestrator.test.ts`
- Modify: `apps/desktop/src/main/alfred-orchestrator.ts`
- Modify: `apps/desktop/src/renderer/app.test.tsx`
- Modify: `apps/desktop/src/renderer/app.tsx`

**Interfaces:**
- Consumes: existing `AlfredPlanRequest`, `AlfredPlanResponse`, `runLlmPlan`, `preflightAlfredPlan`, and preload `requestPlan`.
- Produces: unchanged IPC shape; unexpected main failures use `malformed`, rejected renderer invocations use `network`.

- [ ] **Step 1: Add a failing main-process IPC regression**

Create `alfred-orchestrator.test.ts` with hoisted mocks so the registered
`planRequest` handler can be called directly:

```ts
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => unknown>(),
  preflightAlfredPlan: vi.fn(),
  runLlmPlan: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, request: unknown) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));
vi.mock("./alfred-llm.js", () => ({
  DEFAULT_MODEL: "test-model",
  runLlmPlan: mocks.runLlmPlan,
}));
vi.mock("./alfred-launch-preflight.js", () => ({
  preflightAlfredPlan: mocks.preflightAlfredPlan,
}));
```

Register the IPC once per isolated module load, make preflight reject on the
first call, then succeed on the second:

```ts
it("returns a safe failure and releases inFlight after preflight throws", async () => {
  mocks.runLlmPlan.mockResolvedValue({
    ok: true,
    plan: { sessions: [{ kind: "shell", title: "test", command: "pnpm", args: ["test"] }] },
  });
  mocks.preflightAlfredPlan
    .mockRejectedValueOnce(new Error("fixture preflight exploded"))
    .mockResolvedValueOnce({
      sessions: [{ kind: "shell", title: "test", command: "pnpm", args: ["test"] }],
    });

  registerAlfredIpc();
  const handler = mocks.handlers.get(alfredChannels.planRequest);
  expect(handler).toBeDefined();

  await expect(handler?.({}, planRequest)).resolves.toEqual({
    ok: false,
    error: {
      code: "malformed",
      message: "Alfred could not prepare this plan.",
    },
  });
  await expect(handler?.({}, planRequest)).resolves.toMatchObject({ ok: true });
});
```

Add the same assertion with `runLlmPlan` rejecting, or use `it.each` for the
planner and preflight throw sites. Spy on `console.error` and restore it after
the test; assert only the safe response, not the raw diagnostic text.

- [ ] **Step 2: Run the focused main test and verify failure**

Run:

```bash
pnpm --filter @alfred/desktop test -- alfred-orchestrator.test.ts
```

Expected: the handler rejects because `planRequest` has no `catch`.

- [ ] **Step 3: Catch unexpected main-process failures**

Keep the existing `finally` as the single `inFlight` reset and add only a
`catch` before it:

```ts
      } catch (error: unknown) {
        console.error("[alfred-orchestrator] failed to prepare plan", error);
        return {
          ok: false,
          error: {
            code: "malformed",
            message: "Alfred could not prepare this plan.",
          },
        };
      } finally {
        inFlight = false;
      }
```

Do not expose `error.message` to the renderer and do not change the existing
structured LLM failure or `in_flight` branches.

- [ ] **Step 4: Add a failing renderer rejection-and-retry regression**

Near the existing `"keeps the draft when Alfred plan creation fails"` test,
configure the bridge to reject once and succeed once:

```ts
it("recovers when the plan IPC rejects and allows a successful retry", async () => {
  const user = userEvent.setup();
  const { requestPlan } = installDesktopBridge();
  requestPlan
    .mockRejectedValueOnce(new Error("fixture bridge rejection"))
    .mockResolvedValueOnce(planResponse);

  render(<App />);
  await openPrepareWork(user);
  const composer = screen.getByLabelText("Dispatch instruction");
  await user.type(composer, "retry this plan");
  await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Alfred runtime request failed. Try again.",
  );
  expect(composer).toBeEnabled();
  expect(composer).toHaveValue("retry this plan");

  await user.click(screen.getByRole("button", { name: /Prepare work (?:in|with) / }));
  expect(await screen.findByRole("article", { name: /Staged Task A/i })).toBeInTheDocument();
  expect(requestPlan).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 5: Run the focused renderer test and verify failure**

Run:

```bash
pnpm --filter @alfred/desktop test -- app.test.tsx -t "plan IPC rejects"
```

Expected: an unhandled rejected promise leaves the composer in `thinking`.

- [ ] **Step 6: Guard the renderer process boundary**

Wrap only the preload invocation:

```ts
    let response: AlfredPlanResponse;
    try {
      response = await alfredApi.requestPlan({
        dispatchTarget,
        prompt,
        workspace: workspacePlanContext(activeWorkspace, activeSessions, dispatchTarget),
      });
    } catch {
      setAlfredStatus(errored({
        code: "network",
        message: "Alfred runtime request failed. Try again.",
      }));
      return false;
    }
```

Keep the existing structured-response branch and successful flow unchanged.

- [ ] **Step 7: Run planning tests and typecheck**

Run:

```bash
pnpm --filter @alfred/desktop test -- alfred-orchestrator.test.ts app.test.tsx
pnpm --filter @alfred/desktop typecheck
```

Expected: both throw sites return safe failures, the second attempt succeeds,
and TypeScript reports no errors.

- [ ] **Step 8: Commit the planning boundary**

```bash
git add \
  apps/desktop/src/main/alfred-orchestrator.ts \
  apps/desktop/src/main/alfred-orchestrator.test.ts \
  apps/desktop/src/renderer/app.tsx \
  apps/desktop/src/renderer/app.test.tsx
git commit -m "fix: recover from Alfred planning failures"
```

---

### Task 2: Reuse Review / Edit for every staged agent kind

**Files:**
- Modify: `apps/desktop/src/renderer/components/AgentTimelinePanel.tsx`
- Modify: `apps/desktop/src/renderer/components/AgentTimelinePanel.test.tsx`
- Modify: `apps/desktop/src/renderer/app.test.tsx`

**Interfaces:**
- Consumes: existing `onUpdateStagedSession(sessionId, patch)` and the current command/args/cwd editor.
- Produces: no new props or IPC; all `stage === "staged"` sessions are editable when the callback exists.

- [ ] **Step 1: Replace the obsolete coding-agent read-only test**

Replace `"keeps coding-agent staged sessions read-only until launch defaults are wired"`
with a table-driven Codex/Claude editor test:

```ts
it.each(["codex", "claude"] as const)(
  "lets staged %s sessions save command changes for re-check",
  async (agentKind) => {
    const user = userEvent.setup();
    const onUpdateStagedSession = vi.fn().mockResolvedValue(undefined);
    const session: SessionTile = {
      id: `staged-${agentKind}`,
      title: `review ${agentKind}`,
      workspaceId: "w1",
      stage: "staged",
      cwd: "/repo",
      source: "alfred",
      agentKind,
      command: agentKind,
      args: ["--old"],
    };

    render(<AgentTimelinePanel session={session} onUpdateStagedSession={onUpdateStagedSession} />);
    await user.click(screen.getByRole("button", { name: "Edit command" }));
    await user.clear(screen.getByLabelText("Arguments"));
    await user.type(screen.getByLabelText("Arguments"), "--new");
    await user.click(screen.getByRole("button", { name: "Save and re-check" }));

    expect(onUpdateStagedSession).toHaveBeenCalledWith(session.id, {
      command: agentKind,
      args: ["--new"],
      cwd: "/repo",
    });
  },
);
```

Add non-staged regressions using the real `SessionTile` model (`stage` stays
`"live"` while runtime state distinguishes active/recovery cases):

```ts
it.each(["live", "restored", "exited"] as const)(
  "does not edit live sessions with %s runtime status",
  (runtimeStatus) => {
    render(
      <AgentTimelinePanel
        session={{ ...sessionFixture, stage: "live", runtimeStatus }}
        onUpdateStagedSession={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit command" })).not.toBeInTheDocument();
  },
);
```

Supply the other runtime fields required by the existing fixture builders
rather than weakening the fixture type.

- [ ] **Step 2: Verify the coding-agent test fails**

Run:

```bash
pnpm --filter @alfred/desktop test -- AgentTimelinePanel.test.tsx -t "staged codex|staged claude"
```

Expected: the Edit command button is absent for Codex and Claude.

- [ ] **Step 3: Widen the existing gate by one condition**

Replace:

```ts
return session.stage === "staged" && (session.agentKind === "shell" || session.agentKind === "dev-server");
```

with:

```ts
return session.stage === "staged";
```

Do not fork the editor or add local safety logic.

- [ ] **Step 4: Add an app-level authoritative re-check regression**

Extend the blocked staged command flow with a Codex plan. After opening
Review / Edit, edit `command`, `args`, and `cwd`; mock
`updateStagedSession` to return the authoritative refreshed plan:

```ts
updateStagedSession.mockResolvedValueOnce({
  ok: true,
  plan: {
    ...blockedPlan,
    sessions: [{
      ...blockedPlan.sessions[0],
      command: "codex",
      args: ["exec", "--safe"],
      cwd: "apps/desktop",
      safetyNote: undefined,
      preflight: { status: "ready" },
    }],
  },
});
```

Assert:

```ts
expect(updateStagedSession).toHaveBeenCalledWith({
  planId: blockedPlan.id,
  sessionId: blockedPlan.sessions[0]?.id,
  patch: {
    command: "codex",
    args: ["exec", "--safe"],
    cwd: "apps/desktop",
  },
  workspace: expect.any(Object),
});
expect(screen.getByRole("button", { name: /Launch/ })).toBeEnabled();
expect(screen.queryByText(/old blocker/i)).not.toBeInTheDocument();
```

Retain the existing shell edit integration test and inline save-error test.

- [ ] **Step 5: Run staged-edit tests**

Run:

```bash
pnpm --filter @alfred/desktop test -- AgentTimelinePanel.test.tsx app.test.tsx
pnpm --filter @alfred/desktop typecheck
```

Expected: Codex, Claude, shell, and dev-server staged editing is green;
non-staged sessions remain read-only.

- [ ] **Step 6: Commit the editor gate**

```bash
git add \
  apps/desktop/src/renderer/components/AgentTimelinePanel.tsx \
  apps/desktop/src/renderer/components/AgentTimelinePanel.test.tsx \
  apps/desktop/src/renderer/app.test.tsx
git commit -m "fix: edit all staged agent commands"
```

---

### Task 3: Move workspace and layout effects out of state updaters

**Files:**
- Modify: `apps/desktop/src/renderer/app.tsx`
- Modify: `apps/desktop/src/renderer/app.test.tsx`

**Interfaces:**
- Consumes: existing workspace/layout state snapshots, `setWorkspaceState`,
  `setWorkspaceLayout`, `setWorkspaceViewState`, and pure layout helpers.
- Produces: unchanged UI and IPC payloads, with at most one external call per user action.

- [ ] **Step 1: Add failing exactly-once regressions**

Cover representative state families under `StrictMode`:

```tsx
render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Add or tighten assertions for:

1. fallback folder binding creates one workspace and one manual session without
   nested setters;
2. rename and mission-brief save call `setWorkspaceState` exactly once with
   the complete next workspace list;
3. collapse calls `setWorkspaceViewState` exactly once with the next collapsed
   IDs;
4. preset, move, resize, and cross-workspace focus call
   `setWorkspaceLayout` once per action;
5. selection calls `setWorkspaceViewState` once only when the selection
   changes.

Use `waitFor` only for async bridge resolution, then:

```ts
expect(setWorkspaceState).toHaveBeenCalledTimes(1);
expect(setWorkspaceLayout).toHaveBeenCalledTimes(1);
expect(setWorkspaceViewState).toHaveBeenCalledTimes(1);
```

Do not assert React's updater invocation count; assert observable state and
effect count.

- [ ] **Step 2: Run the focused workspace/layout tests and verify failure**

Run the exact test names added in Step 1:

```bash
pnpm --filter @alfred/desktop test -- app.test.tsx -t "exactly once|workspace rename|mission brief|layout"
```

Expected: at least the updater-owned persistence assertions expose replayable
effects or the current nested-setter structure.

- [ ] **Step 3: Make fallback workspace creation deterministic before setters**

Use the captured `workspaces` snapshot:

```ts
const index = workspaces.length + 1;
const workspace: Workspace = {
  id: `W${index}`,
  label: `Workspace ${index}`,
  shortLabel: `W${index}`,
};
setWorkspaces([...workspaces, workspace]);
setActiveWorkspaceId(workspace.id);
setTerminalSessions((sessions) => addManualSession(sessions, "", workspace.id));
```

No setter may be called from inside `setWorkspaces`.

- [ ] **Step 4: Compute workspace persistence before committing state**

For rename and mission brief, derive `nextWorkspaces` from the captured
`workspaces`, then commit and persist:

```ts
const nextWorkspaces = workspaces.map((workspace) =>
  workspace.id === activeWorkspace.id
    ? { ...workspace, label: nextLabel, shortLabel: shortLabelForWorkspace(nextLabel) }
    : workspace,
);
setWorkspaces(nextWorkspaces);
void workspaceApi?.setWorkspaceState({
  workspaces: nextWorkspaces,
  activeWorkspaceId: activeWorkspace.id,
});
```

Use the same order for mission brief. Add `workspaces` to callback
dependencies. Do not create a generic transaction helper.

- [ ] **Step 5: Compute collapse, selection, and layout maps outside updaters**

Follow one local pattern in each handler:

```ts
const workspaceId = activeWorkspace.id;
const currentLayouts = tileLayoutsByWorkspace[workspaceId] ?? {};
const workspaceLayouts = moveTileLayout(
  ensureTileLayouts(activeSessions, currentLayouts),
  tileId,
  deltaCol,
  deltaRow,
);
const nextLayoutsByWorkspace = {
  ...tileLayoutsByWorkspace,
  [workspaceId]: workspaceLayouts,
};

setTileLayoutsByWorkspace(nextLayoutsByWorkspace);
void layoutApi?.setWorkspaceLayout({ workspaceId, layouts: workspaceLayouts });
```

Apply this to:

- `handleToggleCollapseSession`;
- `handleApplyLayoutPreset`;
- `handleSelectSession`;
- `handleMoveTile`;
- `handleResizeTile`;
- `handleFocusSessionInWorkspace`.

Skip both the setter and IPC when the existing equality guard says nothing
changed. Keep `handleApplyWorkMode` as the coordinator, but ensure its called
handlers no longer hide persistence inside an updater.

- [ ] **Step 6: Re-scan the named workspace/layout scope**

Run:

```bash
rg -n -U \
  'set(Workspaces|CollapsedSessionIdsByWorkspace|SelectedSessionIdsByWorkspace|TileLayoutsByWorkspace)\\([^;]{0,1200}(set[A-Z]|setWorkspace(State|Layout|ViewState)|void )' \
  apps/desktop/src/renderer/app.tsx
```

Manually inspect each match. Expected: no IPC/persistence or nested setter
inside the named functional updaters. False-positive matches caused by the
next handler in the file are acceptable only after direct inspection.

- [ ] **Step 7: Run renderer tests and typecheck**

Run:

```bash
pnpm --filter @alfred/desktop test -- app.test.tsx
pnpm --filter @alfred/desktop typecheck
```

Expected: existing workspace/layout behavior remains green and representative
StrictMode effects occur exactly once.

- [ ] **Step 8: Commit workspace/layout purity**

```bash
git add apps/desktop/src/renderer/app.tsx apps/desktop/src/renderer/app.test.tsx
git commit -m "refactor: keep workspace state updaters pure"
```

---

### Task 4: Make recovery and staged-plan transitions replay-safe

**Files:**
- Modify: `apps/desktop/src/renderer/app.tsx`
- Modify: `apps/desktop/src/renderer/app.test.tsx`

**Interfaces:**
- Consumes: `terminalSessionsRef`, recovery safety helpers, runtime timestamps,
  staged-plan snapshot helpers, and existing staged-plan IPC.
- Produces: unchanged session/status behavior; deterministic time/IDs and exactly-once staged-plan effects.

- [ ] **Step 1: Add failing recovery and deterministic-value regressions**

Add focused tests that:

- click unsafe Continue once and observe one warning plus one armed state;
- click again and observe one relaunch transition with the armed ID removed;
- repeat the same contract for Restart;
- mock `Date.now`, attach a runtime without `createdAt`, and assert the single
  `"Session attached"` event uses the precomputed timestamp;
- submit one prompt under `StrictMode`, spy on UUID/time generation used by
  `createStagedPlanSnapshot`, and assert one stable plan ID plus one
  `setStagedPlan` call.

Use the existing bridge fixtures and session builders. Assert behavior:

```ts
expect(setStagedPlan).toHaveBeenCalledTimes(1);
expect(setStagedPlan.mock.calls[0]?.[0].id).toBe(expectedPlanId);
expect(resolveStagedPlan).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the focused recovery/plan tests and verify failure**

Run:

```bash
pnpm --filter @alfred/desktop test -- app.test.tsx -t "relaunch|restart|Session attached|stable plan|exactly once"
```

Expected: tests demonstrate the current nested setter, updater-time timestamp,
or updater-owned persistence paths.

- [ ] **Step 3: Compute Continue and Restart decisions before setters**

Read the current session from `terminalSessionsRef.current`, calculate safety,
then perform each state update independently:

```ts
const sessions = terminalSessionsRef.current;
const session = sessions.find((item) => item.id === sessionId);
if (!session || !canRelaunchRestoredSession(session)) return;

const safety = sessionRelaunchSafety(session);
if (!safety.safe && !armedRecoverySessionIds.has(sessionId)) {
  setArmedRecoverySessionIds(new Set(armedRecoverySessionIds).add(sessionId));
  setTerminalSessions(appendSessionActivity(sessions, sessionId, warningActivity));
  return;
}

const nextArmed = new Set(armedRecoverySessionIds);
nextArmed.delete(sessionId);
setArmedRecoverySessionIds(nextArmed);
setTerminalSessions(appendSessionActivity(relaunchRestoredSession(sessions, sessionId), sessionId, lifecycleActivity));
```

Use the equivalent existing `restartSession` branch for Restart. Do not merge
the two handlers into a speculative abstraction.

- [ ] **Step 4: Compute runtime attachment time before the updater**

Move:

```ts
const attachmentAt = runtime.createdAt ?? Date.now();
```

above `setTerminalSessions`, then let the updater only attach and derive its
return value. Keep `startingSessionIdsRef` and close-operation handling in the
event handler, where they already execute once.

- [ ] **Step 5: Build the staged plan before committing React state**

Use `terminalSessionsRef.current` as the request-completion baseline:

```ts
const before = terminalSessionsRef.current;
const after = addStagedSessions(
  before,
  response.plan.sessions,
  activeWorkspace.rootPath ?? "",
  activeWorkspace.id,
);
const stagedPlan = createStagedPlanSnapshot({
  ...(response.plan.name === undefined ? {} : { name: response.plan.name }),
  prompt,
  sessions: after.slice(before.length),
});
const nextPendingPlan = stagedPlan
  ? {
      id: stagedPlan.id,
      ...(stagedPlan.name === undefined ? {} : { name: stagedPlan.name }),
      prompt: stagedPlan.prompt,
      sessionIds: stagedPlan.sessions.map((session) => session.id),
      workspaceId: activeWorkspace.id,
    }
  : null;

setTerminalSessions(after);
setPendingPlan(nextPendingPlan);
if (stagedPlan) void alfredApi.setStagedPlan(stagedPlan);
else void alfredApi.clearStagedPlan();
```

Keep the existing plan-request guard as the authority against concurrent
submissions. Do not introduce a new queue or lock.

- [ ] **Step 6: Move Reject IPC outside its pending-plan updater**

The same root cause exists in `handleRejectTile`. Derive the next plan from
the captured `pendingPlan`, commit it, then resolve once:

```ts
const remaining = pendingPlan?.sessionIds.filter((id) => id !== tileId) ?? [];
setTerminalSessions((sessions) => rejectStaged(sessions, tileId));
setPendingPlan(
  pendingPlan
    ? remaining.length === 0
      ? null
      : { ...pendingPlan, sessionIds: remaining }
    : null,
);
void alfredApi?.resolveStagedPlan({ sessionIds: [tileId] });
```

If no pending plan owns the tile, retain the current local rejection behavior
but do not invent a persistence request.

- [ ] **Step 7: Re-scan the S5 session/plan scope**

Run:

```bash
rg -n -U \
  'set(TerminalSessions|PendingPlan)\\([^;]{0,1600}(set[A-Z]|Date\\.now\\(|randomUUID|setStagedPlan|clearStagedPlan|resolveStagedPlan|void )' \
  apps/desktop/src/renderer/app.tsx
```

Inspect each result through the end of its callback. Expected: no nested
setter, time/ID generation, or Alfred IPC remains inside the S5-owned
updaters. Do not expand into unrelated renderer cleanup.

- [ ] **Step 8: Run renderer tests and typecheck**

Run:

```bash
pnpm --filter @alfred/desktop test -- app.test.tsx
pnpm --filter @alfred/desktop typecheck
```

Expected: recovery, runtime attachment, Prepare Work, reject, and staged-plan
persistence behavior remains green.

- [ ] **Step 9: Commit session/plan purity**

```bash
git add apps/desktop/src/renderer/app.tsx apps/desktop/src/renderer/app.test.tsx
git commit -m "refactor: keep session state updaters pure"
```

---

### Task 5: Match file operations as complete words

**Files:**
- Modify: `apps/desktop/src/shared/session-activity.test.ts`
- Modify: `apps/desktop/src/shared/session-activity.ts`

**Interfaces:**
- Consumes and produces: unchanged `classifyTerminalOutputActivity`.
- Behavior change: embedded `unmodified`, `overwritten`, and `rewritten` are not file operations.

- [ ] **Step 1: Add positive and negative table tests**

Add:

```ts
it.each([
  ["Updated app.tsx", "updated"],
  ["Modified app.tsx", "updated"],
  ["Wrote report.md", "wrote"],
  ["Written report.md", "wrote"],
] as const)("classifies complete file operation words: %s", (line, operation) => {
  expect(classifyTerminalOutputActivity(line)).toMatchObject({
    kind: "file",
    payload: { type: "file", operation },
  });
});

it.each([
  "unmodified file.ts",
  "overwritten output.log",
  "rewritten config.json",
])("does not classify embedded operation words: %s", (line) => {
  expect(classifyTerminalOutputActivity(line)).toBeNull();
});
```

- [ ] **Step 2: Run the classifier test and verify failure**

Run:

```bash
pnpm --filter @alfred/desktop test -- session-activity.test.ts
```

Expected: the three negative cases are incorrectly classified as file
activity.

- [ ] **Step 3: Correct only the two alternations**

Replace:

```ts
if (/\bupdated|modified\b/i.test(line)) return "updated";
if (/\bwrote|written\b/i.test(line)) return "wrote";
```

with:

```ts
if (/\b(updated|modified)\b/i.test(line)) return "updated";
if (/\b(wrote|written)\b/i.test(line)) return "wrote";
```

Do not broaden `extractPath` or add a parser.

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @alfred/desktop test -- session-activity.test.ts
pnpm --filter @alfred/desktop typecheck
```

Expected: supported positives remain file events and embedded negatives return
`null`.

- [ ] **Step 5: Commit the classifier fix**

```bash
git add \
  apps/desktop/src/shared/session-activity.ts \
  apps/desktop/src/shared/session-activity.test.ts
git commit -m "fix: match complete file activity words"
```

---

### Task 6: Verify S5, observe Electron behavior, review, and close out

**Files:**
- Review: all files changed by Tasks 1–5
- Modify: `docs/superpowers/specs/2026-07-30-phase-s5-desktop-interaction-correctness-design.md`
- Modify: `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Interfaces:**
- Produces: evidence-backed S5 closeout only; the parent stabilization roadmap remains open with S6 next.

- [ ] **Step 1: Run the focused S5 gate**

Run:

```bash
pnpm --filter @alfred/desktop test -- \
  alfred-orchestrator.test.ts \
  AgentTimelinePanel.test.tsx \
  app.test.tsx \
  session-activity.test.ts
pnpm --filter @alfred/desktop typecheck
pnpm --filter @alfred/desktop build
```

Expected: focused tests, desktop typecheck, and desktop build all pass.

- [ ] **Step 2: Run the full repository gate**

Run:

```bash
pnpm verify
```

Expected: all repository tests, typechecks, builds, and Electron checks pass.

- [ ] **Step 3: Perform focused review**

Review the diff against the accepted spec:

```bash
git diff main...HEAD -- \
  apps/desktop/src/main/alfred-orchestrator.ts \
  apps/desktop/src/main/alfred-orchestrator.test.ts \
  apps/desktop/src/renderer/app.tsx \
  apps/desktop/src/renderer/app.test.tsx \
  apps/desktop/src/renderer/components/AgentTimelinePanel.tsx \
  apps/desktop/src/renderer/components/AgentTimelinePanel.test.tsx \
  apps/desktop/src/shared/session-activity.ts \
  apps/desktop/src/shared/session-activity.test.ts
```

Check specifically:

- every planning request reaches `idle` or `errored`;
- no exception detail crosses the main-process boundary;
- non-staged sessions remain non-editable;
- authoritative update responses replace stale blocker state;
- S5-owned functional updaters contain no effects;
- each user action causes at most one persistence/destructive IPC call;
- only the two accepted file-operation expressions changed.

Resolve every Critical, Important, and Minor review finding before continuing.

- [ ] **Step 4: Read the direct-observation protocol**

Read completely:

```bash
sed -n '1,260p' /Users/patryk/.codex/skills/project-convergence/references/visual-observation.md
```

Follow its direct-observation and evidence rules. Do not substitute a browser
mock for the Electron observation.

- [ ] **Step 5: Observe the accepted Electron workflow**

Launch an isolated Alfred instance with fixture planning responses, temporary
user data, and a temporary `ALFRED_CODEX_HOME`. Do not use `~/.codex`.

Observe in the real Electron window:

1. Prepare Work rejects once.
2. A visible retryable error appears and the composer remains enabled with its
   draft.
3. The next submission succeeds and produces staged work.
4. A blocked staged Codex item opens through Review / Edit.
5. Editing command, args, or cwd and saving shows the refreshed
   safety/preflight state.
6. A safe authoritative result becomes launchable; a still-unsafe fixture
   remains blocked with its new reason.

Record the fixture, launch command, observed states, and screenshot/evidence
paths in the closeout notes. Shut down the isolated instance afterward.

- [ ] **Step 6: Run the final gate after review fixes**

Run:

```bash
pnpm verify
git status --short
```

Expected: `pnpm verify` passes and only intended implementation/docs changes
plus Patryk's pre-existing untracked `.impeccable/` and `.tmp/` remain.

- [ ] **Step 7: Update S5 status and roadmap evidence**

In the S5 spec:

- set `Status: Complete`;
- record focused test, typecheck, build, full `pnpm verify`, focused-review,
  and direct Electron evidence;
- name the implementation commit hashes.

In the post-v1 roadmap:

- mark S5 Complete;
- close findings 5, 11, 17, and 23 with the relevant commits/tests;
- route the next phase to S6 findings 12, 20, and 21;
- keep the parent roadmap open and do not claim S6/S7 work is complete.

- [ ] **Step 8: Commit S5 closeout**

```bash
git add \
  docs/superpowers/specs/2026-07-30-phase-s5-desktop-interaction-correctness-design.md \
  docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
git commit -m "docs: close S5 desktop interaction correctness"
```

- [ ] **Step 9: Stop before external publication**

Report:

- implementation and closeout commit hashes;
- focused and full gate results;
- Electron observation evidence;
- remaining S6/S7 roadmap scope;
- current branch and ahead/behind state.

Do not push until Patryk explicitly authorizes it.
