# Terminal Workspace UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Alfred's Work screen preserve layout intent while users switch sessions and projects, expose direct terminal arrangement by default, keep project/session navigation understandable, and keep terminal identity and compact chrome accurate.

**Architecture:** Preserve the existing Work/Inbox/Sessions/Context surface model and the persisted layout store. Split session selection from the explicit Focus action, keep project disclosure local to the navigator, reuse the existing Arrange machinery instead of creating another layout system, and derive automatic terminal names from the existing foreground-agent signal without overwriting user names. Finish with a bounded CSS polish pass using the current tokens and `ChromeMenu` primitive.

**Tech Stack:** React 19, TypeScript, Electron IPC, Vitest, Testing Library, CSS container queries, xterm.js.

## Global Constraints

- Work only in an isolated worktree and a plain descriptive branch.
- Do not change the already-resolved Work/Sessions/Inbox ownership model or reintroduce top-level tabs.
- Do not redesign Context; only regression-test that it still docks and progressively discloses details.
- Do not add dependencies, a second layout store, new global color tokens, gradients, glow, glass, or decorative motion.
- Preserve manual session rename authority: automatic Codex/Claude naming may replace only generated terminal titles.
- Preserve keyboard operation, focus visibility, and `prefers-reduced-motion` behavior.
- Keep Free Chats separate from project-owned sessions.
- Use the existing `LayoutApi` merge semantics; do not add persistence for project disclosure or Arrange unless a later requirement explicitly asks for it.
- Run narrow tests after every task. Because this plan touches shared desktop behavior, run full `pnpm test`, `pnpm typecheck`, and `pnpm build` before closeout.
- Do not push without Patryk's explicit approval and never add an AI co-author trailer.
- Keep this as the only implementation artifact for the initiative: do not create phase specs, mockup HTML files, or local evidence folders. After the implementation is merged and closed out, remove this roadmap so completed planning does not remain active documentation.

## Product Contract

The Work screen has one job: let the user move between projects and sessions and manage several terminals without an unexpected layout change or ambiguous terminal identity.

The final interaction contract is:

1. A single click on a session in Projects selects it and opens Work, but preserves Grid, Split, Focus, or Arrange.
2. Entering Focus remains explicit: double-click a terminal header, choose Focus from Layout, or invoke a command whose action explicitly says Focus/Open in Work.
3. Switching projects expands the new project but does not collapse projects the user already expanded.
4. Every project with live sessions has one disclosure control; the workspace actions menu remains a separate ellipsis control.
5. Arrange is the initial Work layout, using the existing move and resize behavior; choosing Grid, Split, or Focus exits Arrange.
6. A generated `Manual · zsh N` title becomes `Codex · session N` or `Claude · session N` when foreground-agent detection changes. A custom title never changes automatically.
7. Compact terminal chrome remains readable at 420–620 px tile widths, and the collapsed project rail remains recognizable without adding labels everywhere.

## Delivery Order

| Gate | Scope | Risk | Exit signal |
|---|---|---:|---|
| 1 | Selection without implicit Focus | High | Grid/Split/Focus all survive a Projects click |
| 2 | Independent project disclosure | Medium | Two project groups remain open and each can collapse |
| 3 | Arrange as initial mode | High | Direct move/resize is available on load; presets still exit Arrange |
| 4 | Codex/Claude generated titles | Medium | Icon, title, renderer state, and terminal snapshot agree |
| 5 | Compact chrome and collapsed rail | Low | No clipping at dense widths; active destinations remain obvious |
| 6 | Causal motion and full validation | Low | State matrix, Electron smoke, tests, typecheck, and build pass |

Do not combine Gates 1–4 into one commit. Gate 3 is the broadest behavioral change and should be reviewed in isolation before visual polish begins.

## File Map

- `apps/desktop/src/renderer/app.tsx`: owns cross-workspace selection, explicit Focus, Arrange default, renderer-to-terminal rename persistence, and screen composition.
- `apps/desktop/src/renderer/components/ProjectNavigator.tsx`: owns project disclosure and session navigation semantics.
- `apps/desktop/src/renderer/components/ProjectNavigator.test.tsx`: tests disclosure, multi-project expansion, Free Chats, and callback ownership.
- `apps/desktop/src/renderer/session-state.ts`: owns generated session-title derivation and foreground-agent state updates.
- `apps/desktop/src/renderer/session-state.test.ts`: tests generated-title changes and protection of custom names.
- `apps/desktop/src/renderer/components/WorkSurfaceToolbar.tsx`: continues to own the Layout menu; no new toolbar is needed.
- `apps/desktop/src/renderer/components/WorkSurfaceToolbar.test.tsx`: verifies Arrange/Grid mode labels and exit behavior.
- `apps/desktop/src/renderer/components/TerminalDesk.tsx`: keeps the existing move, resize, collapse, and compact-action owners.
- `apps/desktop/src/renderer/app.test.tsx`: integration tests for layout preservation, Arrange default, persisted automatic names, and Focus behavior.
- `apps/desktop/src/renderer/styles.css`: project disclosure, collapsed rail, compact terminal menu, and bounded motion.
- `apps/desktop/src/renderer/styles-contract.test.ts`: tests responsive ownership and reduced-motion contracts.

---

### Task 1: Decouple session selection from Focus

**Files:**
- Modify: `apps/desktop/src/renderer/app.tsx:975`
- Modify: `apps/desktop/src/renderer/components/ProjectNavigator.tsx:19`
- Test: `apps/desktop/src/renderer/components/ProjectNavigator.test.tsx:125`
- Test: `apps/desktop/src/renderer/app.test.tsx:4929`

**Interfaces:**
- Consumes: existing `LayoutApi.setWorkspaceViewState`, `activeSurface`, `workModesByWorkspace`, and `selectedSessionIdsByWorkspace`.
- Produces: `handleSelectSessionInWorkspace(workspaceId: string, sessionId: string): void` and `ProjectNavigatorProps.onSelectSessionInWorkspace`.
- Preserves: `handleFocusSessionInWorkspace` for explicit Focus callers such as Inbox recovery, Sessions actions, the command palette, and double-clicking a tile header.

- [ ] **Step 1: Add an integration test that reproduces the Grid-to-Focus regression**

Add a test beside the existing Focus-mode tests in `app.test.tsx`:

```tsx
it("selects a project session without replacing the current Grid layout", async () => {
  const { setWorkspaceLayout, setWorkspaceViewState } = installDesktopBridge(undefined, null, [
    liveSnapshot("manual-1", { title: "Manual · zsh 1", agentKind: undefined, command: undefined }),
    liveSnapshot("manual-2", { title: "Manual · zsh 2", agentKind: undefined, command: undefined }),
  ]);
  render(<App />);

  expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Manual · zsh 2" }));

  expect(screen.getByLabelText("terminals")).toHaveClass("mode-desk");
  expect(screen.getByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: /Manual · zsh 2/i })).toBeInTheDocument();
  expect(setWorkspaceLayout).not.toHaveBeenCalled();
  expect(setWorkspaceViewState).toHaveBeenLastCalledWith({
    workspaceId: "A",
    viewState: { workMode: "desk", selectedSessionId: "manual-2" },
  });
});
```

Reuse the existing `liveSnapshot` helper in `app.test.tsx`; do not introduce a new fixture module.

- [ ] **Step 2: Run the regression test and confirm the current failure**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/app.test.tsx -t "selects a project session without replacing the current Grid layout"
```

Expected before implementation: FAIL because `handleFocusSessionInWorkspace` changes the work mode to `focus` and applies a Focus layout.

- [ ] **Step 3: Introduce the selection-only callback in `app.tsx`**

Add the callback next to `handleFocusSessionInWorkspace`:

```tsx
const handleSelectSessionInWorkspace = useCallback((workspaceId: string, sessionId: string) => {
  const targetExists = terminalSessionsRef.current.some(
    (session) => session.workspaceId === workspaceId && session.id === sessionId,
  );
  if (!targetExists) return;

  const workMode = workModesByWorkspace[workspaceId] ?? "desk";
  setActiveSurface("work");
  setActiveWorkspaceId(workspaceId);
  setSelectedSessionIdsByWorkspace((current) =>
    current[workspaceId] === sessionId ? current : { ...current, [workspaceId]: sessionId },
  );
  void getDesktopLayoutApi()?.setWorkspaceViewState({
    workspaceId,
    viewState: { workMode, selectedSessionId: sessionId },
  });
  void refreshLiveSessions();
}, [refreshLiveSessions, workModesByWorkspace]);
```

Do not call `applyLayoutPreset`, `setWorkspaceLayout`, or `setWorkModesByWorkspace` from this callback.

- [ ] **Step 4: Route only ProjectNavigator session clicks through selection**

Rename the prop in `ProjectNavigator.tsx`:

```tsx
onSelectSessionInWorkspace: (workspaceId: string, sessionId: string) => void;
```

Use it for project session rows and Free Chats. In `app.tsx`, pass `handleSelectSessionInWorkspace` to `ProjectNavigator`. Leave `CommandPalette`, Inbox, Sessions, and explicit Focus paths connected to `handleFocusSessionInWorkspace`.

- [ ] **Step 5: Update component tests for the new callback owner**

Replace `onFocusSessionInWorkspace` with `onSelectSessionInWorkspace` only in `ProjectNavigator.test.tsx`, and assert:

```tsx
expect(onSelectSessionInWorkspace).toHaveBeenCalledWith("A", "codex-live");
```

Keep the existing explicit Focus integration test unchanged to prove double-click still isolates one terminal.

- [ ] **Step 6: Run the narrow tests**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/ProjectNavigator.test.tsx src/renderer/app.test.tsx
```

Expected: PASS, including the new Grid-preservation test and the existing Focus tests.

- [ ] **Step 7: Commit the behavior slice**

```bash
git add apps/desktop/src/renderer/app.tsx apps/desktop/src/renderer/app.test.tsx apps/desktop/src/renderer/components/ProjectNavigator.tsx apps/desktop/src/renderer/components/ProjectNavigator.test.tsx
git commit -m "fix: preserve layout when selecting project sessions"
```

---

### Task 2: Add independent project-session disclosure

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectNavigator.tsx:45`
- Modify: `apps/desktop/src/renderer/styles.css:738`
- Test: `apps/desktop/src/renderer/components/ProjectNavigator.test.tsx:101`
- Test: `apps/desktop/src/renderer/styles-contract.test.ts:1059`

**Interfaces:**
- Consumes: `isActiveNavigatorSession(session, workspaceId)`, existing workspace order, Free Chats classification, and `NavigatorSessionButton`.
- Produces: local `expandedWorkspaceIds: Set<string>` and one accessible disclosure button per project that has live sessions.
- Persistence ceiling: expansion survives project switching during the mounted navigator lifetime but intentionally resets on application relaunch.

- [ ] **Step 1: Replace the old single-active-project expectation with disclosure tests**

Add these assertions to `ProjectNavigator.test.tsx`:

```tsx
it("keeps previously expanded project sessions visible after the active project changes", () => {
  const projectSessions = [
    ...sessions,
    liveSession("client-live", "Claude · Client review", "CLIENT", "/repo/client", "claude"),
  ];
  const view = renderNavigator({ activeWorkspaceId: "A", sessions: projectSessions });
  expect(screen.getByRole("group", { name: "Alfred sessions" })).toBeVisible();

  view.rerender(navigator({ activeWorkspaceId: "CLIENT", sessions: projectSessions }));

  expect(screen.getByRole("group", { name: "Alfred sessions" })).toBeVisible();
  expect(screen.getByRole("group", { name: "ClientApp sessions" })).toBeVisible();
});

it("lets the user collapse a project's sessions independently", async () => {
  renderNavigator();
  const disclosure = screen.getByRole("button", { name: "Collapse Alfred sessions" });
  expect(disclosure).toHaveAttribute("aria-expanded", "true");

  await userEvent.click(disclosure);

  expect(screen.queryByRole("group", { name: "Alfred sessions" })).not.toBeInTheDocument();
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
});
```

Adapt these snippets to the existing `renderNavigator` rerender helper instead of adding a parallel harness.

- [ ] **Step 2: Run the disclosure tests and confirm they fail**

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/ProjectNavigator.test.tsx
```

Expected before implementation: FAIL because only `activeSessions` is rendered and no disclosure exists.

- [ ] **Step 3: Store expanded project IDs locally**

In `ProjectNavigator.tsx`, initialize the active project and add newly active projects without removing earlier entries:

```tsx
const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
  () => new Set([activeWorkspaceId]),
);

useEffect(() => {
  setExpandedWorkspaceIds((current) => {
    if (current.has(activeWorkspaceId)) return current;
    return new Set([...current, activeWorkspaceId]);
  });
}, [activeWorkspaceId]);
```

Do not add this state to `WorkspaceViewState`; it is navigator presentation state, not terminal layout state.

- [ ] **Step 4: Render sessions per workspace and add one disclosure owner**

Inside the workspace loop, compute:

```tsx
const workspaceSessions = sessions.filter((session) => isActiveNavigatorSession(session, workspace.id));
const sessionsExpanded = expandedWorkspaceIds.has(workspace.id);
const sessionGroupId = `project-${workspace.id}-sessions`;
```

Add a `ChevronRight` button only when `workspaceSessions.length > 0`:

```tsx
<button
  type="button"
  className="project-session-disclosure"
  aria-controls={sessionGroupId}
  aria-expanded={sessionsExpanded}
  aria-label={`${sessionsExpanded ? "Collapse" : "Expand"} ${workspace.label} sessions`}
  onClick={() => setExpandedWorkspaceIds((current) => {
    const next = new Set(current);
    if (next.has(workspace.id)) next.delete(workspace.id);
    else next.add(workspace.id);
    return next;
  })}
>
  <ChevronRight aria-hidden="true" size={13} />
</button>
```

Keep `workspaceActions` as the sole ellipsis/menu owner. Render the session group when `sessionsExpanded` and give it `id={sessionGroupId}`.

- [ ] **Step 5: Update CSS without adding a second visual language**

Extend the existing `.project-row` grid to include the disclosure and reuse the current neutral control treatment:

```css
.project-session-disclosure {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-5);
}

.project-session-disclosure[aria-expanded="true"] svg {
  transform: rotate(90deg);
}
```

In the collapsed navigator, keep project and session destinations operable. Hide the new disclosure control together with workspace actions; do not create a second flyout.

- [ ] **Step 6: Update style contracts and run narrow tests**

Assert that there is exactly one `.project-session-disclosure` rule, that its expanded state rotates the icon, and that the old assertion forbidding disclosure is removed.

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/ProjectNavigator.test.tsx src/renderer/styles-contract.test.ts
```

Expected: PASS; Free Chats and attention-count tests remain unchanged.

- [ ] **Step 7: Commit the disclosure slice**

```bash
git add apps/desktop/src/renderer/components/ProjectNavigator.tsx apps/desktop/src/renderer/components/ProjectNavigator.test.tsx apps/desktop/src/renderer/styles.css apps/desktop/src/renderer/styles-contract.test.ts
git commit -m "feat: keep project session groups independently expandable"
```

---

### Task 3: Make existing Arrange behavior the default

**Files:**
- Modify: `apps/desktop/src/renderer/app.tsx:182`
- Test: `apps/desktop/src/renderer/app.test.tsx:4335`
- Test: `apps/desktop/src/renderer/components/WorkSurfaceToolbar.test.tsx:1`

**Interfaces:**
- Consumes: existing `arrangeMode`, `handleToggleArrangeMode`, `TerminalDesk` pointer/keyboard move and resize handlers, and Layout menu exit behavior.
- Produces: initial `arrangeMode === true` on launch. No new state type or IPC field.
- Preserves: choosing Grid, Split, or Focus exits Arrange through `WorkSurfaceToolbar.applyWorkMode`.

- [ ] **Step 1: Add a failing default-mode test**

In `app.test.tsx`, assert the initial loaded terminal exposes existing Arrange controls:

```tsx
it("starts Work in Arrange while keeping layout presets available", async () => {
  render(<App />);

  expect(await screen.findByRole("article", { name: /Manual · zsh 1/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Open layout menu, Arrange selected/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Resize Manual · zsh 1" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /Open layout menu, Arrange selected/i }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Grid" }));

  expect(screen.getByRole("button", { name: /Open layout menu, Grid selected/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and confirm the current default is Grid**

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/app.test.tsx -t "starts Work in Arrange"
```

Expected before implementation: FAIL because `arrangeMode` starts as `false`.

- [ ] **Step 3: Change only the initial Arrange state**

In `app.tsx`:

```tsx
const [arrangeMode, setArrangeMode] = useState<boolean>(true);
```

Do not change `TerminalDesk` geometry, `WorkMode`, persisted layout records, or the Layout menu. The existing implementation already supplies pointer drag, resize handles, keyboard movement, and keyboard resizing.

- [ ] **Step 4: Update toolbar expectations and run layout tests**

Keep `WorkSurfaceToolbar` component tests explicit by passing `arrangeMode={true}` for the new default-state case and retaining `arrangeMode={false}` cases for Grid/Focus/Split rendering.

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/WorkSurfaceToolbar.test.tsx src/renderer/app.test.tsx
```

Expected: PASS, including pointer and keyboard arrange tests and the test proving Grid exits Arrange.

- [ ] **Step 5: Commit the default-mode slice**

```bash
git add apps/desktop/src/renderer/app.tsx apps/desktop/src/renderer/app.test.tsx apps/desktop/src/renderer/components/WorkSurfaceToolbar.test.tsx
git commit -m "feat: start terminal workspaces in arrange mode"
```

---

### Task 4: Keep generated terminal names aligned with detected agents

**Files:**
- Modify: `apps/desktop/src/renderer/session-state.ts:467`
- Modify: `apps/desktop/src/renderer/app.tsx:1519`
- Test: `apps/desktop/src/renderer/session-state.test.ts:657`
- Test: `apps/desktop/src/renderer/app.test.tsx:6839`

**Interfaces:**
- Consumes: `TerminalDataEvent.foregroundAgentKind`, `TerminalApi.rename`, and existing `recordSessionOutputActivity`.
- Produces: `generatedTitleForDetectedAgent(session, kind): string`.
- Naming contract: only `Manual · zsh N`, `Codex · session N`, and `Claude · session N` are generated titles. Any other normalized title is user-owned.

- [ ] **Step 1: Add pure state tests for generated and custom titles**

Add to `session-state.test.ts`:

```ts
it.each([
  ["codex", "Codex · session 4"],
  ["claude", "Claude · session 4"],
] as const)("renames a generated manual title for detected %s", (kind, expectedTitle) => {
  const next = recordSessionOutputActivity(
    [{
      id: "manual-4",
      runtimeId: "pty-a",
      title: "Manual · zsh 4",
      workspaceId: "A",
      cwd: "/repo",
      source: "manual",
      stage: "live",
      runtimeStatus: "live",
    }],
    { id: "pty-a", clientId: "manual-4", data: "", foregroundAgentKind: kind, activities: [] },
  );
  expect(next[0]?.title).toBe(expectedTitle);
});

it("does not overwrite a custom title when an agent is detected", () => {
  const next = recordSessionOutputActivity(
    [{
      id: "manual-4",
      runtimeId: "pty-a",
      title: "Release reviewer",
      workspaceId: "A",
      cwd: "/repo",
      source: "manual",
      stage: "live",
      runtimeStatus: "live",
    }],
    { id: "pty-a", clientId: "manual-4", data: "", foregroundAgentKind: "codex", activities: [] },
  );
  expect(next[0]?.title).toBe("Release reviewer");
});
```

- [ ] **Step 2: Run the pure tests and confirm the title remains unchanged**

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/session-state.test.ts -t "generated manual title|custom title"
```

Expected before implementation: FAIL because only `detectedAgentKind` changes.

- [ ] **Step 3: Add one generated-title helper and reuse it**

In `session-state.ts`:

```ts
const GENERATED_TERMINAL_TITLE = /^(?:Manual · zsh|Codex · session|Claude · session) (\d+)$/;

export function generatedTitleForDetectedAgent(
  session: Pick<SessionTile, "title">,
  kind: TerminalDataEvent["foregroundAgentKind"],
): string {
  if (!kind) return session.title;
  const match = GENERATED_TERMINAL_TITLE.exec(session.title);
  if (!match) return session.title;
  const owner = kind === "codex" ? "Codex" : "Claude";
  return `${owner} · session ${match[1]}`;
}
```

In `recordSessionOutputActivity`, set:

```ts
title: generatedTitleForDetectedAgent(item, event.foregroundAgentKind),
detectedAgentKind: event.foregroundAgentKind,
```

This allows a generated Codex title to become Claude if the foreground process changes later, while custom names remain untouched.

- [ ] **Step 4: Persist the automatic rename through the existing Terminal API**

In `handleRuntimeSessionOutput`, before `setTerminalSessions`, compute the generated title from the matched session. When it differs, call:

```tsx
void getDesktopTerminalApi()?.rename({ clientId: session.id, title: generatedTitle });
```

Use the same exported helper; do not duplicate the title regex in `app.tsx`. This prevents the next terminal snapshot from restoring the old `Manual · zsh N` title.

- [ ] **Step 5: Add an integration test for renderer state and persistence**

Using `emitData` and `renameTerminal` returned by the existing `installDesktopBridge` helper, emit terminal data with `foregroundAgentKind: "claude"` for `manual-1`, then assert:

```tsx
expect(await screen.findByRole("article", { name: /Claude · session 1/i })).toBeInTheDocument();
expect(renameTerminal).toHaveBeenCalledWith({ clientId: "manual-1", title: "Claude · session 1" });
```

Add a second assertion that a manually renamed session remains unchanged after a Codex foreground event.

- [ ] **Step 6: Run state and integration tests**

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/session-state.test.ts src/renderer/app.test.tsx src/main/terminal-manager.test.ts
```

Expected: PASS; existing Codex and Claude icon-detection tests remain green.

- [ ] **Step 7: Commit the naming slice**

```bash
git add apps/desktop/src/renderer/session-state.ts apps/desktop/src/renderer/session-state.test.ts apps/desktop/src/renderer/app.tsx apps/desktop/src/renderer/app.test.tsx
git commit -m "fix: align generated terminal titles with detected agents"
```

---

### Task 5: Refine compact Projects and terminal chrome

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css:650`
- Modify: `apps/desktop/src/renderer/styles.css:1272`
- Modify: `apps/desktop/src/renderer/styles.css:2707`
- Test: `apps/desktop/src/renderer/styles-contract.test.ts:1364`
- Test: `apps/desktop/src/renderer/components/ProjectNavigator.test.tsx:268`

**Interfaces:**
- Consumes: existing `--ink-*`, `--signal-focus`, `.project-session-disclosure`, `ChromeMenu`, `.tile-overflow-menu`, and terminal container queries.
- Produces: readable compact-action menu, stronger selected-state recognition, and a collapsed rail whose icons retain hover/focus labels.
- Does not produce: new colors, a new popover component, additional terminal metadata, or a second sidebar mode.

- [ ] **Step 1: Add style-contract assertions for compact menu ownership**

Extend the existing compact terminal action test to require:

```ts
const compactMenu = singleTopLevelRuleBodyIn(styles, ".tile-overflow-menu .chrome-menu-popover");
expect(compactMenu).toContain("min-width: 180px");
expect(compactMenu).toContain("max-width: calc(100vw - 16px)");
expect(compactMenu).toContain("overflow: visible");
```

Keep the current container-query rule that swaps utility actions for the overflow menu at 620 px.

- [ ] **Step 2: Add the smallest owner-specific compact-menu rule**

In `styles.css`, directly after the shared `.chrome-menu-popover` block:

```css
.tile-overflow-menu .chrome-menu-popover {
  min-width: 180px;
  width: 220px;
  max-width: calc(100vw - 16px);
  overflow: visible;
}

.tile-overflow-menu .chrome-menu-popover button {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
```

Do not change the shared Work/launch surface menus. Keep text truncation only for genuinely long labels and paths.

- [ ] **Step 3: Strengthen recognition in the collapsed project rail**

Reuse the existing `data-label` tooltip behavior for project and session destinations. Add a quiet active treatment that is more than a one-pixel boundary:

```css
.project-navigator.is-collapsed .project-row-button[aria-current="location"],
.project-navigator.is-collapsed .project-session.is-active {
  background: color-mix(in oklab, var(--signal-focus) 10%, var(--ink-2));
  color: var(--ink-7);
}
```

Keep the 46 px rail width and current host tokens. Do not add labels, pills, or brand-color backgrounds to every row.

- [ ] **Step 4: Keep compact terminal hierarchy intentionally sparse**

Retain the current container-query reductions:

- hide kind text by 680 px;
- move utility/danger actions into overflow by 620 px;
- hide title metadata and activity by 520 px;
- retain the selected header tint and kind icon.

Delete any duplicate override introduced while implementing this task rather than appending a competing selector later in the stylesheet.

- [ ] **Step 5: Run component and style tests**

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/ProjectNavigator.test.tsx src/renderer/styles-contract.test.ts
```

Expected: PASS with one compact menu owner and no changes to the global `ChromeMenu` keyboard behavior.

- [ ] **Step 6: Commit the compact polish slice**

```bash
git add apps/desktop/src/renderer/styles.css apps/desktop/src/renderer/styles-contract.test.ts apps/desktop/src/renderer/components/ProjectNavigator.test.tsx
git commit -m "fix: refine compact terminal and project navigation chrome"
```

---

### Task 6: Add restrained causal motion and complete visual verification

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css:646`
- Test: `apps/desktop/src/renderer/styles-contract.test.ts:690`

**Interfaces:**
- Consumes: existing project disclosure, navigator width states, selected terminal state, and reduced-motion media blocks.
- Produces: short transitions that explain expand/collapse and selection without animating terminal output or adding ambient motion.

- [ ] **Step 1: Add motion contract tests before CSS changes**

Require these properties in the existing owners:

```ts
expect(exactBlockFor(".workspace-layout")).toContain("transition: grid-template-columns 180ms ease-out");
expect(exactBlockFor(".project-navigator")).toContain("transition: width 180ms ease-out");
expect(exactBlockFor(".project-session-disclosure svg")).toContain("transition: transform 140ms ease-out");
```

In the existing `prefers-reduced-motion: reduce` contract, assert those owners use `transition: none`.

- [ ] **Step 2: Add only causal transitions**

Add:

```css
.workspace-layout {
  transition: grid-template-columns 180ms ease-out;
}

.project-navigator {
  transition: width 180ms ease-out;
}

.project-session-disclosure svg {
  transition: transform 140ms ease-out;
}
```

Extend the existing reduced-motion block:

```css
@media (prefers-reduced-motion: reduce) {
  .workspace-layout,
  .project-navigator,
  .project-session-disclosure svg {
    transition: none;
  }
}
```

Do not animate xterm content, terminal height while output is streaming, or every hover state. Grid-to-Focus geometry remains immediate until a dedicated layout-animation requirement exists.

- [ ] **Step 3: Run the complete automated verification**

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform the browser state matrix**

Run the renderer on its assigned worktree port and use browser control. Observe dark theme only because it is the currently supported product theme.

| State | 1280×720 | 900×720 |
|---|---:|---:|
| Two terminals, Grid, select from Projects | required | required |
| Five terminals, Arrange, selected tile | required | required |
| Two expanded projects with one group collapsed | required | required |
| Collapsed Projects rail with active session | required | required |
| Compact terminal overflow menu open | required | required |
| Context open beside Work | required | required |
| Reduced motion enabled | required | one viewport sufficient |

For each state, capture a screenshot, inspect console errors, and verify:

- session selection never changes the chosen layout;
- selected project/session is recognizable without relying only on a border;
- no horizontal overflow or clipped action text;
- project disclosure and workspace actions are distinct;
- terminal title and icon agree for Codex and Claude;
- Context remains readable and does not reintroduce sidebar clipping;
- reduced motion removes the newly added transitions.

- [ ] **Step 5: Run an Electron smoke for real PTY identity**

Using a fixture or temporary `ALFRED_CODEX_HOME` rather than `~/.codex`:

1. Start a manual terminal.
2. Enter `codex`; verify icon and generated title become Codex.
3. Start another manual terminal and enter `claude`; verify icon and generated title become Claude.
4. Rename one terminal manually, produce another foreground-agent event, and verify the custom name survives.
5. Restart Alfred and verify the automatic name survives the live-session refresh.

- [ ] **Step 6: Commit final motion and verification contracts**

```bash
git add apps/desktop/src/renderer/styles.css apps/desktop/src/renderer/styles-contract.test.ts
git commit -m "style: add restrained workspace transition feedback"
```

## Closeout Criteria

The implementation is complete only when all of the following are true:

- Clicking a Projects session in Grid leaves all Grid terminals visible.
- Clicking a Projects session in Focus changes the focused session but does not leave Focus.
- At least two project session groups can remain expanded simultaneously.
- Every project session group can be collapsed independently with a keyboard-operable disclosure.
- Arrange is selected on initial Work load and Grid/Focus/Split explicitly exit it.
- Generated manual names track Codex and Claude detection and persist through terminal refresh.
- Custom session names are never overwritten by detection.
- Free Chats, Inbox attention, Context disclosure, and workspace actions retain their current behavior.
- Compact action menus are readable at 420, 520, and 620 px tile widths.
- Collapsed Projects remains navigable and clearly indicates active project/session.
- New motion is causal, under 200 ms, and disabled by reduced motion.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check` pass.

## Self-Review

- Spec coverage: all three still-active issues and all six partial issues from `docs/do_poprawy.md` are either implemented or explicitly protected from regression. Already-resolved navigation, Context, Inbox attention, and sidebar clipping are validation-only.
- Placeholder scan: clean; every task contains concrete files, tests, commands, implementation shape, and an exit condition.
- Type consistency: `onSelectSessionInWorkspace`, `handleSelectSessionInWorkspace`, and `generatedTitleForDetectedAgent` use the same signatures in their producer and consumer tasks.
- Scope control: the plan adds no dependency, global design system, layout IPC field, or persistent disclosure state.
