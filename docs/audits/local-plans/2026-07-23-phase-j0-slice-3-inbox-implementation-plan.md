# Phase J0 Slice 3 Inbox Implementation Plan

> **Archival status (2026-08-01):** completed; do not execute. This plan remains
> at its original path only for project-memory v2 provenance. The canonical
> owner is `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`.
> Referenced local scratch and screenshots may have been retired after the
> accepted outcome was preserved in this document and in Git.

**Goal:** Ship the approved global Inbox composition and J0 presentation while
preserving the published attention, action, Recovery, focus, and xterm
contracts.

**Architecture:** Keep the existing `AttentionProjection`, action handlers,
component boundaries, mounted Work runtime, and one Inbox scroll owner.
Change only the shell composition in `app.tsx`, the existing Inbox markup, and
the canonical Inbox CSS owner; prove the unchanged behavioral contracts through
the current unit and Electron suites.

**Tech Stack:** React, TypeScript, CSS, Vitest, Testing Library, Electron,
Playwright.

## Global Constraints

- Parent lineage is `Phase J → J0 Visual Alignment → Slice 3 Inbox → remaining
  J0 obligations`; completing this plan does not close J0 or Phase J.
- `Inbox` is the only user-facing product name; `Needs you` and `Recovery` are
  internal section labels.
- Keep `AttentionProjection`, ranking, section assignment, action types, IPC,
  persistence, and terminal ownership unchanged.
- Do not add a provider, queue model, compatibility layer, feature flag,
  dependency, or breakpoint.
- Replace the existing Inbox CSS owner in place; do not append an override
  layer.
- Product labels use system sans at 13 px or larger; 12 px is reserved for
  secondary captions; mono is limited to technical values and shortcuts.
- Frequently used controls are at least 32 px high.
- Keep one 1180 px responsive breakpoint for Inbox detail stacking.
- Preserve reduced-motion behavior at 0.001 ms.
- Preserve Recovery review/confirm/Discard/Escape safety and Work → Inbox →
  Work `.xterm-screen` identity plus background output.
- Run direct Electron observation serially at 1440×900 and 1120×720 after the
  automated gates.
- Preserve the user-owned native glass changes currently present on `main`;
  they are outside this slice.

---

### Task 1: Make Inbox one global surface

**Risk closed:** removes duplicated navigation and the Work project rail
without changing the mounted terminal runtime, Escape ownership, or action
routing.

**Files:**

- Modify: `apps/desktop/src/renderer/app.tsx:1501-1524,2171-2247,2294-2455`
- Modify: `apps/desktop/src/renderer/app.test.tsx:885-900`
- Modify: `apps/desktop/src/renderer/components/ReviewSurface.tsx:1-208`
- Modify: `apps/desktop/src/renderer/components/ReviewSurface.test.tsx:57-220`

**Interfaces:**

- Consumes: the existing `activeSurface`, `handleSelectPrimarySurface`,
  `restoreWorkFocusPendingRef`, `AttentionProjection`, and Inbox action
  callbacks.
- Produces: `ReviewSurfaceProps.onBackToWork: () => void`; a 52 px Inbox
  toolbar; one global Inbox surface with no `ProjectNavigator`, internal
  `SurfaceSwitcher`, or persistent status bar.

- [ ] **Step 1: Write the failing component contract**

Replace the old secondary-switcher/status-bar assertions in
`ReviewSurface.test.tsx` with:

```tsx
const handlers = {
  onLaunch: vi.fn(),
  onOpenInWork: vi.fn(),
  onRecover: vi.fn(),
  onDiscardRecovery: vi.fn(),
  onReviewEdit: vi.fn(),
  onBackToWork: vi.fn(),
};

it("renders the single global Inbox toolbar without duplicate navigation or status chrome", async () => {
  const user = userEvent.setup();
  const handlers = renderSurface();
  const surface = screen.getByRole("region", { name: "Inbox workspace" });

  expect(surface).toHaveAttribute("data-secondary-chrome-height", "52");
  expect(within(surface).getByRole("heading", { name: "Inbox" })).toBeVisible();
  expect(within(surface).getByText("All projects", { exact: true })).toBeVisible();
  expect(within(surface).getByText("3 need you · 0 recovery", { exact: true })).toBeVisible();
  expect(within(surface).queryByRole("navigation", { name: "Primary surfaces" })).not.toBeInTheDocument();
  expect(surface.querySelector(".inbox-docket__statusbar")).not.toBeInTheDocument();

  await user.click(within(surface).getByRole("button", { name: "Back to Work" }));
  expect(handlers.onBackToWork).toHaveBeenCalledOnce();
});
```

Delete tests whose only contract is switcher key handling or status-bar label
mirroring. Retain all tests for selection, Enter actions, Recovery safety, and
focus reconciliation; change their assertions to the visible primary action
when necessary.

- [ ] **Step 2: Write the failing app shell contract**

Replace the old navigator-retention test in `app.test.tsx` with:

```tsx
it("removes the Work project navigator from global Inbox and Sessions", async () => {
  const user = userEvent.setup();
  installDesktopBridge();
  render(<App />);

  expect(await screen.findByRole("navigation", {
    name: "Projects and Free Chats",
  })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /open inbox surface/i }));
  expect(screen.getByTestId("workbench-shell")).toHaveClass("surface-inbox");
  expect(screen.queryByRole("navigation", {
    name: "Projects and Free Chats",
  })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back to Work" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Back to Work" }));
  expect(screen.getByRole("navigation", {
    name: "Projects and Free Chats",
  })).toBeInTheDocument();

  await selectSurface(user, "Sessions");
  expect(screen.getByTestId("workbench-shell")).toHaveClass("surface-sessions");
  expect(screen.queryByRole("navigation", {
    name: "Projects and Free Chats",
  })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused tests and confirm the contract fails**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run \
  src/renderer/components/ReviewSurface.test.tsx \
  src/renderer/app.test.tsx
```

Expected: FAIL because `ReviewSurface` still exposes the internal switcher and
status bar, uses 36 px chrome, and `app.tsx` still renders `ProjectNavigator`
for Inbox.

- [ ] **Step 4: Implement the minimal shell change**

In `ReviewSurface.tsx`:

```tsx
type ReviewSurfaceProps = {
  attentionItems: AttentionProjection[];
  armedRecoverySessionIds: ReadonlySet<string>;
  sessionDetailsById: ReadonlyMap<string, Pick<SessionTile, "args" | "command" | "cwd">>;
  onLaunch: (sessionId: string) => void;
  onOpenInWork: (workspaceId: string, sessionId: string) => void;
  onRecover: (workspaceId: string, sessionId: string) => void;
  onDiscardRecovery: (sessionId: string) => void;
  onReviewEdit: (workspaceId: string, sessionId: string) => void;
  onBackToWork: () => void;
};

<header className="inbox-docket__toolbar" aria-label="Inbox toolbar">
  <button
    type="button"
    className="inbox-docket__back"
    aria-label="Back to Work"
    onClick={onBackToWork}
  >
    <ChevronLeft aria-hidden="true" size={16} />
  </button>
  <span className="inbox-docket__title">
    <strong role="heading" aria-level={1}>Inbox</strong>
    <small>All projects</small>
  </span>
  <span className="inbox-docket__summary">
    {decisions.length} need you · {recoveryItems.length} recovery
  </span>
</header>
```

Set `data-secondary-chrome-height="52"` on the existing `<section>`, replace
the current `.inbox-docket__chrome` element with the toolbar above, keep the
`.inbox-docket__canvas` block in place, and delete the footer. Remove
`SurfaceSwitcher`, `PrimarySurface`, `FocusEvent`,
`attentionActionLabel`, `recoveryActionLabel`,
`focusedPrimaryActionLabel`, `focusedRecoverySessionId`,
`statusActionLabel`, `handleFocusCapture`, and the footer. Keep
`runPrimaryAction`, selection reconciliation, keyboard movement, and Recovery
rendering unchanged.

In `app.tsx`, reuse the existing focus restoration mechanism:

```tsx
const handleExitInboxToWork = useCallback(() => {
  if (armedRecoverySessionIds.size > 0) {
    setArmedRecoverySessionIds(new Set());
    return;
  }
  restoreWorkFocusPendingRef.current = true;
  setActiveSurface("work");
}, [armedRecoverySessionIds]);
```

Render the Work navigator only for Work by changing this one condition:

```tsx
// before
{activeSurface !== "sessions" && (

// after
{activeSurface === "work" && (
```

Replace the existing `ReviewSurface` callback prop exactly:

```tsx
onBackToWork={handleExitInboxToWork}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run \
  src/renderer/components/ReviewSurface.test.tsx \
  src/renderer/app.test.tsx
```

Expected: PASS. Existing action, selection, Recovery, Escape, focus, and xterm
tests must remain green.

- [ ] **Step 6: Commit the shell change**

```bash
git add \
  apps/desktop/src/renderer/app.tsx \
  apps/desktop/src/renderer/app.test.tsx \
  apps/desktop/src/renderer/components/ReviewSurface.tsx \
  apps/desktop/src/renderer/components/ReviewSurface.test.tsx
git commit -m "refactor(desktop): make Inbox a global surface"
```

---

### Task 2: Apply the approved flat Inbox presentation

**Risk closed:** aligns hierarchy, type, controls, density, and responsive
behavior without touching projection or action semantics.

**Files:**

- Modify: `apps/desktop/src/renderer/components/ReviewSurface.tsx:160-190`
- Modify: `apps/desktop/src/renderer/components/InboxDecisionItem.tsx:25-103`
- Modify: `apps/desktop/src/renderer/components/InboxRecoveryList.tsx:32-127`
- Modify: `apps/desktop/src/renderer/components/ReviewSurface.test.tsx`
- Modify: `apps/desktop/src/renderer/styles.css:4848-5417,6195-6271`
- Modify: `apps/desktop/src/renderer/styles-contract.test.ts:444-460,1451-1466,1999-2004`
- Modify: `apps/desktop/e2e/css-layout-ownership.spec.ts:82-89,250-264`

**Interfaces:**

- Consumes: the Task 1 toolbar and unchanged `AttentionProjection` plus
  Recovery props.
- Produces: an 860 px centered flat list, J0 typography and controls, one 1180
  px stacking rule, and updated CSS ownership evidence.

- [ ] **Step 1: Write the failing semantic and presentation assertions**

Add to `ReviewSurface.test.tsx`:

```tsx
it("uses Inbox naming and flat section hierarchy", () => {
  renderSurface();
  const inbox = screen.getByRole("region", { name: "Inbox workspace" });

  expect(within(inbox).getByRole("heading", { name: "Needs you" })).toBeVisible();
  expect(within(inbox).getByText("3 decisions", { exact: true })).toBeVisible();
  expect(within(inbox).getByText("Highest impact first", { exact: true })).toBeVisible();
  expect(within(inbox).queryByText("Decision Inbox", { exact: true })).not.toBeInTheDocument();
  expect(within(inbox).queryByText("Needs You", { exact: true })).not.toBeInTheDocument();
});
```

Update `inboxProbes` in `css-layout-ownership.spec.ts`:

```ts
const inboxProbes: CssOwnerProbe[] = [
  { name: "inbox", selector: ".inbox-docket", required: true,
    properties: ["display", "min-height", "overflow", "background-color"] },
  { name: "inbox-toolbar", selector: ".inbox-docket__toolbar", required: true,
    properties: ["display", "height", "min-height", "padding", "background-color"] },
  { name: "inbox-scroll-owner", selector: ".inbox-docket__canvas", required: true,
    properties: ["display", "min-height", "overflow-x", "overflow-y", "padding", "max-width"] },
  { name: "inbox-list", selector: ".inbox-docket__list", required: true,
    properties: ["border-width", "border-radius", "background-color", "overflow"] },
  { name: "inbox-detail", selector: ".inbox-docket__detail-grid", required: true,
    properties: ["display", "grid-template-columns", "min-width", "overflow"] },
];
```

Replace the stale B4 expectations in `styles-contract.test.ts` so the
canonical-owner test requires `52px minmax(0, 1fr)`, an
`.inbox-docket__toolbar` rule, an `860px` canvas, no
`.inbox-docket__statusbar`, and sans summary text at the 12 px caption floor.
Keep the existing orphan-selector, motion, focus, and primary-action checks.

- [ ] **Step 2: Run the focused component and ownership tests**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run \
  src/renderer/components/ReviewSurface.test.tsx \
  src/renderer/styles-contract.test.ts
pnpm --filter @alfred/desktop exec playwright test \
  --config playwright.config.ts e2e/css-layout-ownership.spec.ts
```

Expected: component FAIL on old copy; ownership FAIL because the new toolbar
owner and flat-list values do not exist yet.

- [ ] **Step 3: Apply the minimal markup copy changes**

In `ReviewSurface.tsx`, use:

```tsx
<header className="inbox-docket__header">
  <h2>Needs you <span>{decisions.length} decision{decisions.length === 1 ? "" : "s"}</span></h2>
  <p>Highest impact first</p>
</header>
```

Keep the existing meaningful glyphs, one expanded decision, accessible names,
fact values, and Recovery markup. Change component markup only where a class is
needed by the canonical CSS owner; do not rename the components or add state.

- [ ] **Step 4: Replace the canonical Inbox CSS owner**

Edit the existing Inbox block in `styles.css` so its governing rules match:

```css
.workspace-layout.surface-inbox,
.workspace-layout.surface-inbox.preview-visible {
  position: relative;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 0;
  background: var(--ink-0);
}

.workspace-layout.surface-inbox > .orchestrator-surface {
  grid-column: 1;
}

.inbox-docket {
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--ink-0);
  color: var(--ink-6);
  font-family: var(--sans);
  display: grid;
  grid-template-rows: 52px minmax(0, 1fr);
}

.inbox-docket__toolbar {
  height: 52px;
  min-height: 52px;
  border-bottom: 1px solid var(--ink-3);
  padding: 0 18px;
  background: var(--ink-1);
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.inbox-docket__back {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-5);
  display: grid;
  place-items: center;
}

.inbox-docket__title strong,
.inbox-docket__title small {
  display: block;
  font-family: var(--sans);
}

.inbox-docket__title strong {
  color: var(--ink-7);
  font-size: 14px;
  line-height: 1.2;
}

.inbox-docket__title small,
.inbox-docket__summary {
  color: var(--ink-5);
  font: 500 12px/1.2 var(--sans);
}

.inbox-docket__canvas {
  width: min(860px, calc(100% - 48px));
  max-width: 860px;
  min-height: 0;
  margin: 0 auto;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 34px 0 28px;
  overscroll-behavior: contain;
}

.inbox-docket__list {
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.inbox-docket__item {
  border-bottom: 1px solid var(--ink-3);
  background: transparent;
  transition: background-color 140ms ease-out;
}

.inbox-docket__item:first-child {
  border-top: 1px solid var(--ink-3);
}

.inbox-docket__item-copy strong,
.inbox-docket__recovery-copy strong {
  font: 600 13px/1.3 var(--sans);
}

.inbox-docket__item-copy small,
.inbox-docket__recovery-copy small,
.inbox-docket__header p,
.inbox-docket__facts dt,
.inbox-docket__facts dd {
  font-size: 12px;
}

.inbox-docket__primary,
.inbox-docket__recovery-primary,
.inbox-docket__recovery-secondary {
  min-height: 32px;
  font: 600 13px/1 var(--sans);
}
```

Preserve the existing focus outline, meaningful signal colors, 120–160 ms
transitions, technical mono selectors, and Recovery warning treatment. Move the
current Inbox detail stacking rule from `@media (max-width: 1120px)` into the
existing `@media (max-width: 1180px)` block, then delete obsolete Inbox-only
rules at 1120/980 rather than adding a breakpoint.

- [ ] **Step 5: Add exact geometry assertions**

After opening narrow Inbox in `css-layout-ownership.spec.ts`, replace the
internal switcher exit with Back and assert:

```ts
await expect(page.getByRole("navigation", {
  name: "Projects and Free Chats",
})).toHaveCount(0);
await expect(page.locator(".inbox-docket__statusbar")).toHaveCount(0);
await expect(page.locator(".inbox-docket__toolbar")).toHaveCSS("height", "52px");
await expect(page.locator(".inbox-docket__list")).toHaveCSS("border-radius", "0px");

const frequentControls = [
  page.getByRole("button", { name: "Back to Work" }),
  page.locator(".inbox-docket__primary"),
];
for (const control of frequentControls) {
  expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(32);
}

await page.getByRole("button", { name: "Back to Work" }).click();
await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
```

The CSS ownership fixture has no Recovery rows. Keep the Recovery control-size
assertion in `inbox.spec.ts`, whose mixed fixture has six saved sessions.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run \
  src/renderer/components/ReviewSurface.test.tsx \
  src/renderer/styles-contract.test.ts
pnpm --filter @alfred/desktop exec playwright test \
  --config playwright.config.ts e2e/css-layout-ownership.spec.ts
```

Expected: PASS with one Inbox CSS owner, no duplicate status bar, 52 px
toolbar, flat list, 32 px controls, one scroll owner, and one-column detail at
1120×720.

- [ ] **Step 7: Commit the presentation change**

```bash
git add \
  apps/desktop/src/renderer/components/ReviewSurface.tsx \
  apps/desktop/src/renderer/components/InboxDecisionItem.tsx \
  apps/desktop/src/renderer/components/InboxRecoveryList.tsx \
  apps/desktop/src/renderer/components/ReviewSurface.test.tsx \
  apps/desktop/src/renderer/styles.css \
  apps/desktop/src/renderer/styles-contract.test.ts \
  apps/desktop/e2e/css-layout-ownership.spec.ts
git commit -m "style(desktop): align Inbox with J0"
```

---

### Task 3: Prove behavior and native-size visual integrity

**Risk closed:** catches accidental Recovery, focus, overflow, and xterm
regressions that DOM/CSS assertions alone cannot close.

**Files:**

- Modify: `apps/desktop/e2e/inbox.spec.ts:18-324`
- Modify: `apps/desktop/e2e/css-layout-ownership.spec.ts`
- Create:
  `docs/audits/local-artifacts/2026-07-23-phase-j0-slice-3-inbox/OBSERVATION.md`

**Interfaces:**

- Consumes: Task 1 global shell and Task 2 canonical Inbox styling.
- Produces: Electron proof for naming, shell composition, action truth,
  Recovery safety, responsive geometry, focus restoration, and xterm identity.

- [ ] **Step 1: Update the Electron contract before production changes**

In `inbox.spec.ts`, replace project-rail, internal-switcher, status-bar, and
sticky-footer assertions with:

```ts
await expect(page.getByRole("navigation", {
  name: "Projects and Free Chats",
})).toHaveCount(0);
await expect(inbox.getByRole("heading", { name: "Inbox" })).toBeVisible();
await expect(inbox.getByText("All projects", { exact: true })).toBeVisible();
await expect(inbox.locator(".inbox-docket__statusbar")).toHaveCount(0);
await expect(inbox.getByRole("list", {
  name: "Needs you items",
}).locator(":scope > li[aria-expanded='true']")).toHaveCount(1);
```

For responsive overflow, probe:

```ts
await assertNoHorizontalOverflow(page, "Inbox", [
  inbox.locator(".inbox-docket__toolbar"),
  inbox.getByTestId("inbox-decision-select-B:fixture-item-2"),
  inbox.getByRole("button", { name: "Recovery · 6 saved sessions" }),
]);
```

Keep the existing deterministic action, Recovery review/confirm/Escape,
selection, reduced-motion, scroll, and `.xterm-screen` identity assertions.
Use `Back to Work` or global title-bar controls instead of the deleted internal
surface switcher.

- [ ] **Step 2: Run the focused Electron suites**

Run:

```bash
pnpm --filter @alfred/desktop exec playwright test \
  --config playwright.config.ts \
  e2e/inbox.spec.ts \
  e2e/css-layout-ownership.spec.ts
```

Expected: PASS at fixture-defined native sizes with no runtime errors or
overflow.

- [ ] **Step 3: Commit the Electron contract**

```bash
git add \
  apps/desktop/e2e/inbox.spec.ts \
  apps/desktop/e2e/css-layout-ownership.spec.ts
git commit -m "test(desktop): prove J0 Inbox contract"
```

- [ ] **Step 4: Run the full automated gate**

Run serially:

```bash
pnpm verify:quality
pnpm smoke:electron
git diff --check
```

Expected: lint, typecheck, all tests, build, Electron smoke, and whitespace
checks PASS. Do not treat retries caused by product failures as evidence; fix
the failing owner and rerun.

- [ ] **Step 5: Observe real Electron at 1440×900**

Launch the built desktop app with the deterministic mixed Inbox fixture, set
the native window to 1440×900, and directly verify:

```text
Observed: global Inbox below the title bar; no Work project navigator; one
52 px toolbar; centered flat 860 px list; one expanded decision; truthful
primary action; Recovery collapsed; no status bar; no clipping or overflow.
```

- [ ] **Step 6: Observe real Electron at 1120×720**

Resize the same running native window to 1120×720 and directly verify:

```text
Observed: detail facts stack below the main detail; toolbar, decision row,
primary action, and Recovery remain operable; zero document/control overflow;
Back to Work restores the saved Work target; terminal output continued while
Inbox was open.
```

- [ ] **Step 7: Record the local observation**

Create
`docs/audits/local-artifacts/2026-07-23-phase-j0-slice-3-inbox/OBSERVATION.md`
after running `git rev-parse HEAD`. Write that command's exact output on the
`Commit` line and use these exact remaining fields:

```markdown
# Phase J0 Slice 3 Inbox observation

- Commit: exact output of `git rev-parse HEAD`
- Surface: real Electron
- 1440×900: Observed — PASS
- 1120×720: Observed — PASS
- Global shell: no ProjectNavigator; one 52 px Inbox toolbar
- Naming: Inbox / Needs you / Recovery contract PASS
- Layout: flat 860 px list; narrow detail stacked; zero overflow
- Behavior: actions, Recovery safety, Escape, focus restore PASS
- Runtime continuity: same connected `.xterm-screen`; background output PASS
- Automated gate: `pnpm verify:quality`, `pnpm smoke:electron`,
  `git diff --check` PASS
```

Do not copy the words `exact output of`; record the returned SHA. Do not claim
`Observed` unless the native window was directly inspected. The local audit
artifact is intentionally ignored by Git; keep it as canonical local evidence
and do not force-add it.

## Self-review

- Spec coverage: global surface, single naming, 52 px toolbar, flat list,
  typography, controls, Recovery, keyboard/focus, responsive stacking, xterm
  identity, automated verification, and direct observation each map to a task.
- Architecture: no new state, IPC, queue, provider, dependency, compatibility
  path, or breakpoint.
- Supersession: the plan changes only J0 presentation; Phase I attention,
  action, Recovery, focus, and terminal contracts remain authoritative.
- Scope: Sessions, Context, Privacy, Preview, native glass, and J0 Slice 4
  remain outside this plan.
- Closeout boundary: after Task 3, stop for Slice 3 acceptance; J0 and Phase J
  remain open.
