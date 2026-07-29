# Phase S1 Desktop Safety Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop release gate honest and prevent valid terminal or
desktop state from being silently erased after quit, corruption, or a transient
write failure.

**Architecture:** Keep the current persistence stores and React component
boundaries. Replace only the passive React wheel binding with a native
non-passive listener, make terminal flush start hydration, quarantine invalid
state before defaults can replace it, wire warnings to the main-process log,
and base later mutations on the last failed state.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Playwright, Node.js
filesystem APIs.

**Status:** Complete

## Global Constraints

- Electron remains the only user client.
- Do not change visual styling or accepted layout behavior.
- Do not add dependencies.
- Do not change persisted-state version `1`.
- Preserve existing valid desktop-state files byte-for-byte until the next
  successful mutation.
- Never overwrite an invalid state file unless a quarantine copy was created.
- Keep terminal scroll ownership and xterm keep-alive behavior unchanged.
- Use one focused commit per task.
- Run the full `pnpm verify` gate before phase closeout.

---

## File map

- `apps/desktop/src/renderer/components/TerminalDesk.tsx` — owns terminal-grid
  wheel routing.
- `apps/desktop/src/renderer/app.test.tsx` — regression for wheel routing and
  cancellation.
- `apps/desktop/src/main/terminal-manager.ts` — terminal snapshot hydration and
  flush.
- `apps/desktop/src/main/terminal-manager.test.ts` — regression for quit before
  renderer hydration.
- `apps/desktop/src/main/persisted-desktop-state.ts` — invalid-state quarantine
  and failed-mutation preservation.
- `apps/desktop/src/main/persisted-desktop-state.test.ts` — real-filesystem
  persistence regressions.
- `apps/desktop/src/main/main.ts` — warning sink for persistence failures.
- `apps/desktop/src/main/main.test.ts` — verifies warning wiring.
- `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md` — phase
  status and closeout.

### Task 1: Use a cancellable native wheel listener

**Findings:** 2

**Files:**
- Modify: `apps/desktop/src/renderer/components/TerminalDesk.tsx`
- Test: `apps/desktop/src/renderer/app.test.tsx`

**Interfaces:**
- Consumes: existing `.terminal-grid-column` scroll owner and `.xterm-viewport`
  DOM.
- Produces: the same scroll behavior with a cancelable native `WheelEvent`.

- [x] **Step 1: Strengthen the existing wheel regression**

In `app.test.tsx`, replace the second `fireEvent.wheel` call with an explicit
cancelable event and assert both effects:

```ts
viewport.scrollTop = 600;
const edgeWheel = new WheelEvent("wheel", {
  bubbles: true,
  cancelable: true,
  deltaY: 120,
});
screenElement.dispatchEvent(edgeWheel);
expect(edgeWheel.defaultPrevented).toBe(true);
expect(column.scrollTop).toBe(120);
```

- [x] **Step 2: Run the focused test and verify the new assertion fails**

Run:

```bash
pnpm --filter @alfred/desktop test -- app.test.tsx -t "lets terminal-grid wheel gestures reach lower tiles"
```

Expected: FAIL because React's passive wheel listener cannot cancel the event.

- [x] **Step 3: Bind the wheel handler natively**

In `TerminalDesk.tsx`:

1. remove `ReactWheelEvent` from the React type imports;
2. add `const gridColumnRef = useRef<HTMLDivElement | null>(null);`;
3. replace `handleGridWheelCapture` with a `useEffect` that captures
   `gridColumnRef.current`;
4. register and clean up the same handler:

```ts
useEffect(() => {
  const column = gridColumnRef.current;
  if (!column) return;

  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY === 0 || column.scrollHeight <= column.clientHeight) return;

    const target = event.target instanceof Element ? event.target : null;
    const viewport = target?.closest(".xterm-host")?.querySelector(".xterm-viewport");
    if (!(viewport instanceof HTMLElement)) return;

    const direction = Math.sign(event.deltaY);
    const terminalCanScroll =
      direction > 0
        ? viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1
        : viewport.scrollTop > 1;
    if (terminalCanScroll) return;

    const columnCanScroll =
      direction > 0
        ? column.scrollTop + column.clientHeight < column.scrollHeight - 1
        : column.scrollTop > 1;
    if (!columnCanScroll) return;

    column.scrollTop += event.deltaY;
    event.preventDefault();
  };

  column.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  return () => column.removeEventListener("wheel", handleWheel, { capture: true });
}, []);
```

Attach `ref={gridColumnRef}` to `.terminal-grid-column` and remove
`onWheelCapture`.

- [x] **Step 4: Run focused checks**

```bash
pnpm --filter @alfred/desktop test -- app.test.tsx -t "lets terminal-grid wheel gestures reach lower tiles"
pnpm --filter @alfred/desktop typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/TerminalDesk.tsx apps/desktop/src/renderer/app.test.tsx
git commit -m "fix(desktop): make terminal wheel routing cancellable"
```

### Task 2: Hydrate terminal snapshots before quit flush

**Findings:** 3

**Files:**
- Modify: `apps/desktop/src/main/terminal-manager.ts`
- Test: `apps/desktop/src/main/terminal-manager.test.ts`

**Interfaces:**
- Consumes: existing `hydratePersistedTerminalSessions()` merge behavior.
- Produces: `flushTerminalPersistence()` that cannot replace an unhydrated
  persisted session list with an empty in-memory map.

- [x] **Step 1: Add the quit-before-hydration regression**

Add a test that configures a store containing one restored session, does not
invoke `terminalChannels.list`, calls `flushTerminalPersistence()`, and verifies
the existing snapshot remains:

```ts
it("hydrates persisted snapshots before a quit-time flush", async () => {
  const persistedSnapshot: PersistedTerminalSessionSnapshot = {
    clientId: "persisted-before-quit",
    title: "Persisted before quit",
    source: "manual",
    cwd: "/repo",
    shell: "/bin/zsh",
    buffer: "saved transcript\n",
  };
  let state = stateWithRestoredSessions([persistedSnapshot]);
  const store = storeWithRestoredSessions([persistedSnapshot]);
  vi.mocked(store.updateState).mockImplementation(async (updater) => {
    state = await updater(state);
    return state;
  });
  configureTerminalPersistence(store, { debounceMs: 0 });

  await flushTerminalPersistence();

  expect(store.getState).toHaveBeenCalledOnce();
  expect(state.restoredTerminalSessions).toEqual([persistedSnapshot]);
});
```

- [x] **Step 2: Run the regression and verify it fails**

```bash
pnpm --filter @alfred/desktop test -- terminal-manager.test.ts -t "hydrates persisted snapshots before a quit-time flush"
```

Expected: FAIL because the current flush writes the empty snapshot map.

- [x] **Step 3: Start hydration in the shared persistence function**

At the start of `persistTerminalSnapshots()`, after confirming a store exists,
replace the check for an already-running hydration with:

```ts
await hydratePersistedTerminalSessions();
if (persistedStateStore !== store) return;
```

Do not add a quit-specific branch. All callers of the shared persistence
function receive the same safety invariant.

The implementation also seeds hydration mutations from snapshots already
present in memory, so starting hydration during flush cannot discard a local
pre-hydration snapshot.

- [x] **Step 4: Run terminal-manager tests**

```bash
pnpm --filter @alfred/desktop test -- terminal-manager.test.ts
pnpm --filter @alfred/desktop typecheck
```

Expected: PASS, including the existing concurrent-hydration tests.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/main/terminal-manager.ts apps/desktop/src/main/terminal-manager.test.ts
git commit -m "fix(desktop): hydrate terminal state before flush"
```

### Task 3: Quarantine invalid desktop state and surface warnings

**Findings:** 4, 14

**Files:**
- Modify: `apps/desktop/src/main/persisted-desktop-state.ts`
- Modify: `apps/desktop/src/main/main.ts`
- Test: `apps/desktop/src/main/persisted-desktop-state.test.ts`
- Test: `apps/desktop/src/main/main.test.ts`

**Interfaces:**
- Consumes: `PersistedDesktopStateStoreOptions.onWarning`.
- Produces: one sibling quarantine file named
  `desktop-state.invalid-<timestamp>.json` before defaults are returned.

- [x] **Step 1: Add real-filesystem quarantine regressions**

Extend both existing invalid-state tests:

```ts
const entries = await readdir(path.dirname(filePath));
const quarantineName = entries.find((entry) =>
  /^desktop-state\.invalid-\d+\.json$/.test(entry),
);
expect(quarantineName).toBeDefined();
expect(await readFile(path.join(path.dirname(filePath), quarantineName!), "utf8"))
  .toBe(originalInvalidContents);
await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
```

For the unsupported-version test, also collect warnings and expect:

```ts
expect(warnings).toEqual(["Unsupported desktop state version; preserved invalid file."]);
```

Update the corrupt JSON expectation to the equivalent preserved-file warning.
Import `readdir` from `node:fs/promises`.

- [x] **Step 2: Verify the regressions fail**

```bash
pnpm --filter @alfred/desktop test -- persisted-desktop-state.test.ts -t "falls back safely"
```

Expected: FAIL because no quarantine file exists.

- [x] **Step 3: Add one quarantine helper and use it at both invalid branches**

In `persisted-desktop-state.ts`, use the already imported `rename`:

```ts
async function quarantineDesktopStateFile(filePath: string): Promise<void> {
  const quarantinePath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}.invalid-${Date.now()}${path.extname(filePath)}`,
  );
  await rename(filePath, quarantinePath);
}
```

In `readDesktopStateFile()`:

- when JSON parses but the record/version is invalid, quarantine, warn, and
  return defaults;
- when JSON parsing throws, quarantine, warn, and return defaults;
- if quarantine itself fails, report the quarantine failure and rethrow so a
  later default-state mutation cannot overwrite the only copy.

Do not add a migration framework while version `1` is the only supported
version.

- [x] **Step 4: Add a warning-wiring test**

In `main.test.ts`, assert that desktop state is constructed with an `onWarning`
callback:

```ts
expect(mocks.createPersistedDesktopStateStore).toHaveBeenCalledWith({
  userDataPath: expect.any(String),
  onWarning: expect.any(Function),
});
```

Invoke the captured callback and verify `console.warn` receives the message and
error.

- [x] **Step 5: Wire the warning sink**

In `main.ts`:

```ts
const persistedDesktopStateStore = createPersistedDesktopStateStore({
  userDataPath: app.getPath("userData"),
  onWarning: (message, error) => console.warn(message, error),
});
```

- [x] **Step 6: Run focused checks**

```bash
pnpm --filter @alfred/desktop test -- persisted-desktop-state.test.ts main.test.ts
pnpm --filter @alfred/desktop typecheck
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add apps/desktop/src/main/persisted-desktop-state.ts apps/desktop/src/main/persisted-desktop-state.test.ts apps/desktop/src/main/main.ts apps/desktop/src/main/main.test.ts
git commit -m "fix(desktop): preserve invalid desktop state"
```

### Task 4: Preserve a failed mutation through the next update

**Findings:** 19

**Files:**
- Modify: `apps/desktop/src/main/persisted-desktop-state.ts`
- Test: `apps/desktop/src/main/persisted-desktop-state.test.ts`

**Interfaces:**
- Consumes: existing `failedState` slot and serialized mutation queue.
- Produces: `updateState()` based on `failedState ?? cachedState`.

- [x] **Step 1: Add the two-mutation regression**

Create a real temporary path whose parent is initially a file, fail a
`setState()` containing workspace label `First mutation`, remove the blocker,
then run `updateState()` to maximize the saved window. Assert the final file
contains both changes:

```ts
await expect(store.setState(firstMutation)).rejects.toThrow(
  "Failed to persist desktop state.",
);
await rm(blockingFilePath, { force: true });
await store.updateState((current) => ({
  ...current,
  windowState: {
    ...current.windowState,
    maximized: true,
  },
}));

const persisted = await createPersistedDesktopStateStore({ filePath }).getState();
expect(persisted.workspaces).toEqual(firstMutation.workspaces);
expect(persisted.windowState.maximized).toBe(true);
expect(store.getSaveStatus()).toEqual({ status: "saved" });
```

- [x] **Step 2: Run the regression and verify it fails**

```bash
pnpm --filter @alfred/desktop test -- persisted-desktop-state.test.ts -t "preserves a failed mutation"
```

Expected: FAIL because `updateState()` currently starts from `cachedState`.

- [x] **Step 3: Fix the shared mutation base**

Change only the updater input:

```ts
const baseState = failedState ?? cachedState;
return persistState(await updater(cloneDesktopState(baseState)));
```

Keep `persistState()` responsible for clearing `failedState` only after a
successful write.

- [x] **Step 4: Run focused checks**

```bash
pnpm --filter @alfred/desktop test -- persisted-desktop-state.test.ts
pnpm --filter @alfred/desktop typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/main/persisted-desktop-state.ts apps/desktop/src/main/persisted-desktop-state.test.ts
git commit -m "fix(desktop): retain failed state mutations"
```

### Task 5: Phase verification and closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: a closed S1 phase and an explicit handoff to S2.

- [x] **Step 1: Run focused desktop verification**

```bash
pnpm --filter @alfred/desktop test
pnpm --filter @alfred/desktop typecheck
pnpm --filter @alfred/desktop build
```

Expected: all PASS.

- [x] **Step 2: Run the real Electron smoke**

```bash
pnpm smoke:electron
```

Expected: all scenarios PASS and no
`Unable to preventDefault inside passive event listener invocation` console
error.

- [x] **Step 3: Run the complete repository gate**

```bash
pnpm verify
```

Expected: lint, typecheck, tests, build, and Electron smoke all PASS.

- [x] **Step 4: Focused review**

Review only:

- cancellation and cleanup of the native wheel listener;
- quit before terminal hydration;
- invalid-state preservation and quarantine failure behavior;
- failed-state merge semantics;
- absence of unrelated visual or persistence-format changes.

- [x] **Step 5: Close the phase**

In the roadmap:

- set S1 to `Complete`;
- record the closing commit and verification commands;
- set S2 to `Next`;
- leave all later phases unchanged.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
git commit -m "docs: close desktop safety gate phase"
```

## Self-review

- Spec coverage: findings 2, 3, 4, 14, and 19 each map to a task and regression.
- Product boundary: no browser-client or API behavior is changed in S1.
- Type consistency: all proposed functions and store fields already exist;
  `gridColumnRef` and `quarantineDesktopStateFile` are introduced once.
- Simplicity: no dependency, persisted format, migration framework, feature
  flag, or compatibility path is added.
- Future gate: S3 must inspect every use of `/auth/*`, `/v1/runs`, and
  `/v1/system` again immediately before deletion.
