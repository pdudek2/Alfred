# Alfred UI Canonical Plan

> **For agentic workers:** For multi-step implementation, use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Alfred moving toward a calm graphite operator console where terminal orchestration is the product center, context is supportive, and color/assets carry deliberate meaning.

**Architecture:** This is the single source of truth for Alfred Desktop UI work after the Clean + Depth redesign. Full audits and local plans are source material only; future UI implementation plans should amend this document first, then execute one small phase at a time. Renderer changes must preserve xterm mounting and terminal lifecycle invariants.

**Tech Stack:** Electron renderer, React, xterm.js, CSS custom properties in `apps/desktop/src/renderer/styles.css`, Vitest renderer tests, real Electron smoke via the Alfred desktop app.

## Global Constraints

- This document is the UI/UX SSOT. Do not create competing UI plans unless this file explicitly links to them.
- Source audits:
  - local Fable/Claude report: `docs/audits/fable-ui-audit-2026-07-06/fable-audit-report.md` (ignored by git, source only),
  - current Electron smoke screenshots and user feedback from July 2026.
- Branch work should start from latest `main` unless continuing an active reviewed branch.
- Do not change xterm renderer technology.
- Do not remount, conditionally unmount, or dispose xterm hosts while changing chrome, panels, sidebar, scroll, or typography.
- Keep-alive mechanism, by name: `workSurfaceHidden` in `apps/desktop/src/renderer/app.tsx` (~line 2028) toggles `.surface-panel.inactive`, which hides the desk via `visibility: hidden` + `opacity: 0` + `pointer-events: none` (`styles.css` ~line 1100); focus/split modes hide tiles the same way via `.focus-hidden`. Never replace these with `display: none`, conditional render, or keyed remount.
- Layer discipline: each phase edits the newest canonical layer in `styles.css` instead of appending another `vN` override layer; adding a net-new layer header requires updating Phase 6 scope in this document.
- Visual smoke uses fresh screenshots via `screencapture` or Patryk's own eyes; the Computer Use screenshot stream cached stale frames during the July 2026 smoke and is not trusted for pixel checks.
- Each phase may store local before/after screenshots next to the audit baseline under `docs/audits/` so perception changes stay reviewable. `docs/audits/*` is ignored by git unless a specific artifact is explicitly promoted.
- No new IPC for pure UI phases.
- No dependency changes for pure UI phases.
- Keep the product model: Work / Inbox / History, terminal grid first, Context supportive.
- Palette direction: graphite shell, cyan focus/instrument marker, amber Claude/attention, red risk/destructive, green only safe/ready/success.
- Do not use green as the global primary action identity.
- Avoid new generic SaaS badges, hero copy, marketing layout, and decorative gradients.
- User-facing summaries in Polish.

---

## Current State

### Already In Flight On `ui-token-hierarchy`

**Files:**
- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/src/renderer/styles-contract.test.ts`
- `apps/desktop/src/renderer/composer.tsx`
- `apps/desktop/src/renderer/composer.test.tsx`
- `apps/desktop/src/renderer/components/ReviewSurface.tsx`
- `apps/desktop/src/renderer/components/WorkbenchHeader.tsx`

**Known changes in this branch:**
- Graphite/cyan token hierarchy is quieter than earlier green-heavy versions.
- Dispatch/Prepare bar is closer to a single command capsule.
- Inbox empty/recovery surfaces are less dashboard-like.
- Work/Inbox/History header duplication is reduced.
- Sidebar, Context, and terminal toolbar received a first readability pass.

**Before merge, verify:**
- [x] Run `git diff --check`. (passed after `4fa264d`)
- [x] Run `pnpm --filter @alfred/desktop typecheck`. (passed after `4fa264d`)
- [x] Run `pnpm --filter @alfred/desktop test`. (47 files, 577 tests after `4fa264d`)
- [x] Run `pnpm --filter @alfred/desktop build`. (passed; known Vite large-chunk warning)
- [ ] Smoke in real Electron:
  - [ ] Work with 1 terminal.
  - [ ] Work with 3+ terminals; scroll reaches lower tiles.
  - [ ] Context open and closed.
  - [ ] Inbox recovery list.
  - [ ] History list.
  - [ ] Session quick switch.
  - [ ] Command palette.
  - [ ] Dispatch/Prepare bottom bar.

---

## Coverage And Progress Markers

Use this section before starting any new phase. It prevents old findings from being reimplemented blindly and keeps the Fable audit from turning into a second backlog.

### Done Or Mostly Done In Current Branch

- Dispatch/Prepare bar first pass:
  - one capsule instead of detached pieces,
  - target chip restored,
  - keyboard hint moved into the command surface,
  - status remains visible below the capsule.
- Header dedupe first pass:
  - Workbench header no longer repeats Inbox/History titles above their own surfaces.
- Inbox zero-state cleanup:
  - zero stat cards are hidden,
  - the empty-lane dashboard blocks were removed,
  - copy is shorter.
- Token hierarchy first pass:
  - graphite surfaces are quieter,
  - old neon/green primary bias is removed,
  - cyan is reduced compared with earlier screenshots.
- Context/sidebar readability first pass:
  - several label/value treatments are calmer,
  - terminal toolbar actions are less dominant.
- Grid scroll/arrange safety first pass:
  - 3+ terminal tiles remain reachable by outer grid scroll,
  - arrange resize handle remains reachable.

### Partially Done; Keep In Future Phases

- Typography diet:
  - some labels moved to sans/secondary text,
  - mono-uppercase is still overused in Context, History, sidebars, command surfaces, and some controls.
- Color semantics:
  - palette is calmer,
  - agent identity and selection still use cyan/amber in ways that can read as status instead of identity.
- Context hierarchy:
  - summary is cleaner,
  - Context can still compete with terminal content and can still feel like a second dense dashboard.
- Sidebar hierarchy:
  - some rows are calmer,
  - placeholder letters, wrapped metadata, and repeated workspace/session context remain.
- Terminal grid chrome:
  - toolbar is quieter,
  - status truncation, empty/void states, and control grouping still need a dedicated pass.

### Not Started

- Asset and icon system:
  - workspace/session/inbox marks still rely on letters such as `A`, `W4`, `M`, `Cx`, `Cl`, `FC`, `!`;
  - note: `tile-kind-icon.tsx`, `SessionStatusGlyph.tsx`, and `AlfredMark.tsx` already exist with Lucide icons — Phase 3 wires them in, it does not build a second icon system.
- Work header grouping:
  - layout, panel toggles, agent launchers, and new terminal actions still share one crowded row.
- History density:
  - duplicate descriptions, uneven column heights, and detail-panel tone still need a pass.
- Overlay unification:
  - Quick Switch, Command Palette, privacy modal, and review overlays still need one shared visual system.
- CSS consolidation:
  - the final direction is still protected by override layers and regex-like contract checks.
- Copy tone cleanup:
  - several chrome strings are too explanatory for repeated UI.

### Coverage Check Against Fable Audit

- Fable P0.1 Bottom bar: mostly covered by current branch; keep only small follow-up polish in Phase 1/2 if smoke shows alignment issues.
- Fable P0.2 Dedupe context/counts: partially covered; remaining repetition belongs to Phase 2.
- Fable P0.3 Color semantic collision: partially covered; finish in Phase 3/4 by separating identity from status.
- Fable P0.4 Typography diet: partially covered; finish in Phase 2 and enforce in Phase 6.
- Fable P1.5 Icons/assets: not started; Phase 3.
- Fable P1.6 Sidebar one-line hierarchy: partial; Phase 2 and Phase 3.
- Fable P1.7 Work header controls: not started; Phase 4.
- Fable P1.8 Terminal status truncation: not started; Phase 4.
- Fable P1.9 Grid void/fill: not started as a design pass; Phase 4.
- Fable P1.10 History density: not started; Phase 2.
- Fable P1.11 Overlay unification: not started; Phase 5.
- Fable P1.12 Border/fill diet: partial; Phase 6.
- Fable P2.13 `Cmd T` hint cleanup: not started; Phase 4.
- Fable P2.14 History amber notice demotion: not started; Phase 2.
- Fable P2.15 Title-bar/header merge: deferred; not a blocker for the current polish track.
- Fable P2.16 Motion/interaction states: not started; Phase 6 unless promoted.
- Fable P2.17 Copy tone cleanup: not started; Phase 2.

### Fresh Electron Smoke Findings (2026-07-08)

Screenshots: `docs/audits/fresh-smoke-2026-07-08/`. Captured from the live app on `ui-token-hierarchy` at `4fa264d`.

Confirmed working:
- Terminal tiles fill the workbench in Grid and Focus modes; the dead void below the grid (Fable P1.9) is largely resolved.
- xterm keep-alive held through Work → Inbox → History → overlays → Work; scrollback stayed intact.
- Command palette opens and renders via `Cmd K` (reported Fable command-palette render bug not reproduced) and is already search-first.

New or sharpened findings:
- Quick switch still opens with eyebrow + title + subtitle before the search input and has no kbd footer, while the palette is search-first — the two overlays visibly diverge (Phase 5).
- Privacy modal is a third overlay style (amber `LOCAL CONTROLS` eyebrow, mono subtitle, bordered rows) (Phase 5).
- Inbox renders zero-count sections (`Needs decision 0`, `Blocked & safety 0`) as full-weight rows, and the `1 RECOVERY` stat tile duplicates the `Recovery — 1` row below it (Phase 2).
- Sidebar inbox row reads `1 decisions, blocked runs, recovery` while decisions are 0 and recovery is 1 — the count is attached to the wrong noun; also `1 decisions` and rail a11y `1 items` pluralization bugs (Phase 2 copy).
- History keeps two near-synonymous description sentences; the Projects column lists zero-count workspaces as truncated `Workspac…` rows — false density plus unreadable labels (Phase 2).
- `untrusted cwd` chip repeats on most external session rows — warning-tone noise for a resting state (Phase 2 copy, Phase 3 color semantics).
- Sidebar workspace chip flips between `1 active` and `restored`, mirroring the selected session status on a workspace identity row (Phase 2/3).
- Context section headers double themselves: `IDENTITY`/`Session`, `DETAILS`/`More`, `RECENT ACTIVITY`/`Recent activity` (Phase 2).
- Title bar copy `Workspace 4 workspace` duplicates the word workspace (Phase 2 copy).
- Rail buttons need accessibility-activation verification: AX inspection returned the element, but navigation was not confirmed; pointer clicks work. Treat this as an assistive-tech and UI-automation risk until Phase 6 verifies the handler path.
- Transient layout: right after a window raise, the Focus tile briefly rendered at ~40% width before filling the stage — watch for it during smoke; possibly fit-addon/resize timing.

---

## Phase 1: Close Current Token Hierarchy Slice

**Purpose:** Finish and merge only the work already in the active branch; do not add new product scope here.

**Status (2026-07-08):** command checks (diff --check, typecheck, test, build) already passed after commit `4fa264d`; the accessibility tree confirmed Work/Inbox/History/quick-switch states. What remains is the fresh visual smoke per Global Constraints (Computer Use screenshots were stale).

**Files:**
- Modify only if smoke exposes a bug:
  - `apps/desktop/src/renderer/styles.css`
  - `apps/desktop/src/renderer/styles-contract.test.ts`
  - `apps/desktop/src/renderer/composer.tsx`
  - `apps/desktop/src/renderer/composer.test.tsx`
  - `apps/desktop/src/renderer/terminal-visual-profile.test.ts`
  - `apps/desktop/src/renderer/components/ReviewSurface.tsx`
  - `apps/desktop/src/renderer/components/WorkbenchHeader.tsx`

**Steps:**
- [ ] Check branch state with `git status --short --branch`.
- [ ] Review final diff with `git diff --stat`.
- [ ] Run `git diff --check`.
- [ ] Run `pnpm --filter @alfred/desktop typecheck`.
- [ ] Run `pnpm --filter @alfred/desktop test`.
- [ ] Run `pnpm --filter @alfred/desktop build`.
- [ ] Perform the Electron smoke checklist from **Current State**.
- [ ] Fix only blocking visual/runtime regressions found by smoke.
- [ ] Commit with a small message such as `style(desktop): refine tactical ui hierarchy`.
- [ ] Push only after Patryk explicitly asks.

**Exit criteria:**
- Tests and build pass.
- Real Electron smoke confirms the UI is usable.
- No known xterm remount/regression.
- Branch is ready for review/merge.

---

## Phase 2: Information Hierarchy V2

**Purpose:** Reduce the feeling that everything has equal weight. Terminal content should be primary; Context and sidebar should be navigational/supportive.

**Files:**
- Modify:
  - `apps/desktop/src/renderer/styles.css`
  - `apps/desktop/src/renderer/styles-contract.test.ts`
- Modify only if CSS cannot express the hierarchy:
  - `apps/desktop/src/renderer/components/AgentTimelinePanel.tsx`
  - `apps/desktop/src/renderer/components/ContextColumn.tsx`
  - `apps/desktop/src/renderer/components/ObservatorySurface.tsx` (History surface; single description and column baseline likely need markup, not just CSS)
  - `apps/desktop/src/renderer/components/WorkspaceNavigationPanel.tsx`
  - `apps/desktop/src/renderer/components/WorkspaceRail.tsx`
  - `apps/desktop/src/renderer/components/TerminalDesk.tsx`
  - `apps/desktop/src/renderer/app.tsx` (sidebar rows and repeated workspace copy render here)

**Context panel decisions:**
- Keep immediately visible:
  - selected session title,
  - status,
  - cwd,
  - command/age,
  - key signal.
- Move behind disclosure or visually demote:
  - long fact tables,
  - raw activity,
  - debug-like event streams,
  - repeated labels.

**Sidebar decisions:**
- Session/workspace name first.
- Path/cwd secondary or hover-only when space is tight.
- Empty workspaces should be passive.
- Avoid showing zero-count sections as if they were active work.
- Prefer one-line rows in the resting state.
- Remove dangling separators such as `unavailable ·` when there is no following value.

**History decisions:**
- Keep one description for History, not a header description plus a repeated body description.
- Align Projects / Sessions / Detail panels on one visual baseline.
- Use `height: auto` where possible instead of stretching empty columns to create false density.
- Demote amber notices to inline information unless they require human action.

**Copy decisions:**
- Chrome copy should be short and operational.
- Avoid repeating workspace names in breadcrumb, placeholder, status row, and sidebar simultaneously.
- Empty states should explain the next useful action once, not restate counters.

**Steps:**
- [ ] Add/adjust CSS contract tests for:
  - Context summary stays compact,
  - details/activity are visually secondary,
  - sidebar rows use sans for readable labels,
  - paths/meta remain quieter than names.
- [ ] Add/adjust component assertions where necessary for:
  - zero counters hidden when they are zero,
  - History description appears once,
  - repeated workspace/session copy is reduced in the same viewport.
- [ ] Run targeted test and verify it fails before implementation:
  - `pnpm --filter @alfred/desktop test -- apps/desktop/src/renderer/styles-contract.test.ts`
- [ ] Implement the minimal CSS/markup changes.
- [ ] Re-run the targeted test and verify PASS.
- [ ] Run `pnpm --filter @alfred/desktop test`.
- [ ] Smoke real Electron with:
  - Work + Context open,
  - Inbox + Context open,
  - History + Context open,
  - small-ish window width.

**Exit criteria:**
- User can scan Work without Context competing with xterm.
- Sidebar reads as navigation, not a log dump.
- No action disappears; details are still reachable.

---

## Phase 3: Asset And Identity Pass

**Purpose:** Replace generic letter boxes and placeholder identity with Alfred-specific operational marks that fit the app icon direction.

**Files:**
- Extend existing icon components; do not create a parallel icon system (`lucide-react` is already a dependency used across the renderer):
  - `apps/desktop/src/renderer/tile-kind-icon.tsx` (kind → Lucide map already covers claude/codex/manual/shell/dev-server)
  - `apps/desktop/src/renderer/components/SessionStatusGlyph.tsx`
  - `apps/desktop/src/renderer/components/AlfredMark.tsx`
- Modify (letter marks render here):
  - `apps/desktop/src/renderer/app.tsx` (`workspace-nav-mark` short labels ~line 2344, `!` alert ~2362, `FC` ~2384)
  - `apps/desktop/src/renderer/staged-tile.tsx` (`tile-kind-mark`)
  - `apps/desktop/src/renderer/components/WorkspaceNavigationPanel.tsx`
  - `apps/desktop/src/renderer/components/WorkspaceRail.tsx`
  - `apps/desktop/src/renderer/components/TerminalDesk.tsx`
  - `apps/desktop/src/renderer/styles.css`
- Test:
  - `apps/desktop/src/renderer/app.test.tsx`
  - `apps/desktop/src/renderer/styles-contract.test.ts`

**Rules:**
- Replace raw letters where they feel like placeholders:
  - workspace `W4`, `A`, `COD`,
  - session `M`, `Cx`, `Cl`,
  - nav `FC`,
  - inbox `!`.
- Keep accessible labels; icons are visual affordances, not the only text.
- Do not introduce decorative illustrations into the workbench.

**Steps:**
- [ ] Inventory all letter-box marks with `rg -n "workspace-monogram|workspace-nav-mark|tile-kind-mark|shortLabel" apps/desktop/src/renderer` (bare `M`/`!` alternations match too much to be useful).
- [ ] Define a minimal glyph set:
  - workspace,
  - manual shell,
  - Codex,
  - Claude,
  - inbox/attention,
  - history/sessions.
- [ ] Add tests that accessible names remain stable after icon replacement.
- [ ] Implement icons in existing components without changing session/workspace data shape.
- [ ] Run `pnpm --filter @alfred/desktop test`.
- [ ] Smoke Electron at normal and compact widths.

**Exit criteria:**
- UI no longer feels built from placeholder letters.
- Icons align with the app icon direction: graphite base, cyan instrument marks, amber attention, red risk.
- Text labels remain available for clarity and accessibility.

---

## Phase 4: Terminal Grid And Toolbar Hierarchy

**Purpose:** Keep terminal orchestration powerful while making controls calmer and easier to understand.

**Files:**
- Modify:
  - `apps/desktop/src/renderer/components/TerminalDesk.tsx`
  - `apps/desktop/src/renderer/styles.css`
- Test:
  - `apps/desktop/src/renderer/app.test.tsx`
  - `apps/desktop/src/renderer/styles-contract.test.ts`

**Rules:**
- Visible by default:
  - title,
  - status,
  - primary resume/relaunch action when relevant.
- Quiet or hover/focus-led:
  - collapse,
  - open external terminal,
  - rename,
  - discard/close, while still discoverable and accessible.
- Arrange handles must stay reachable at the bottom edge.
- 3+ terminal tiles must be reachable by outer grid scroll.
- Status text must not truncate into unusable fragments such as `WARN Desktop termina...`.
- Empty or unavailable terminal states should use the terminal body space for explanation instead of crowding the tile header.
- The lone `Cmd T` hint should live in the New Terminal affordance, tooltip, or empty state, not as a floating debug-like label.
- Work header controls should resolve into clear groups:
  - layout segmented control,
  - panel toggles,
  - launch action.
- `Codex` and `Claude` launcher pills should not look like primary status controls; prefer a `New terminal` menu when possible.
- Terminal tiles should fill the available workbench height without leaving a dead void below the grid.

**Steps:**
- [ ] Add regression test that 3+ tiles remain reachable by grid scroll.
- [ ] Add CSS contract that utility actions remain secondary to primary runtime state.
- [ ] Add a test or contract for non-truncated important status text.
- [ ] Add a contract that terminal grid wrappers can flex to the available height without hiding lower tiles.
- [ ] Refine toolbar grouping and hover/focus states.
- [ ] Move or demote the `Cmd T` hint.
- [ ] Run targeted tests:
  - `pnpm --filter @alfred/desktop test -- apps/desktop/src/renderer/app.test.tsx apps/desktop/src/renderer/styles-contract.test.ts`
- [ ] Smoke Electron:
  - Grid mode with 3+ terminals,
  - Focus mode,
  - Split mode,
  - Arrange mode bottom resize handle,
  - restored session resume/relaunch.

**Exit criteria:**
- Terminal remains the visual center.
- Utility controls are discoverable but not noisy.
- No xterm host is remounted or disposed by layout changes.

---

## Phase 5: Overlay Unification

**Purpose:** Make Session Quick Switch, Command Palette, and privacy/review overlays feel like one Alfred overlay system.

**Files:**
- Modify:
  - `apps/desktop/src/renderer/styles.css`
  - `apps/desktop/src/renderer/components/SessionObservatoryPanel.tsx` (session quick switch)
  - `apps/desktop/src/renderer/components/CommandPalette.tsx`
  - `apps/desktop/src/renderer/app.tsx` (privacy panel markup lives inline; `privacyPanelOpen` state ~line 178 — there is no `LocalDataPrivacyPanel.tsx`)
- Test:
  - `apps/desktop/src/renderer/app.test.tsx`
  - `apps/desktop/src/renderer/components/SessionObservatoryPanel.test.tsx`

**Rules:**
- One overlay visual language:
  - opaque graphite panel,
  - consistent scrim,
  - search-first where applicable,
  - compact header,
  - keyboard hints where useful.
- No blur/glass.
- Quick switch and command palette should not diverge stylistically.
- Scrim must make the background clearly subordinate; the overlay should not fight with History/Context text behind it.
- Command Palette rendering must be verified in real Electron, not only by DOM tests.

**Steps:**
- [ ] Inventory overlay components and shared classes.
- [ ] Verify remaining `backdrop-filter` declarations stay explicitly pinned to `none`; as of 2026-07-08 all matching declarations are `none`, so this is a regression guard rather than a visual cleanup count.
- [ ] Add CSS contract for overlay panel/scrim tokens.
- [ ] Remove duplicate hero-like headings in quick switch when search already explains the mode.
- [ ] Add keyboard hint footer where it improves discoverability.
- [ ] Run `pnpm --filter @alfred/desktop test`.
- [ ] Smoke Electron:
  - quick switch opens and focuses search,
  - command palette opens and renders,
  - privacy modal opens and closes,
  - review queue remains usable.

**Exit criteria:**
- Overlays feel like one system.
- Command palette rendering bug from the Fable audit is explicitly rechecked.

---

## Phase 6: CSS Consolidation

**Purpose:** Reduce layered override risk after the visual direction stabilizes.

**Files:**
- Modify:
  - `apps/desktop/src/renderer/styles.css`
  - `apps/desktop/src/renderer/styles-contract.test.ts`

**Steps:**
- [ ] Identify duplicate selectors with `rg -n "ALFRED|workspace-button|agent-panel-section|terminal-tile-header|dispatch-bar" apps/desktop/src/renderer/styles.css`.
- [ ] Group final rules by surface:
  - root tokens,
  - shell,
  - sidebar,
  - Work/terminal grid,
  - Context,
  - Inbox/History,
  - overlays,
  - responsive rules.
- [ ] Remove obsolete comments and historical layer headers after tests cover the intended final behavior.
- [ ] Replace fragile regex tests only where a more cascade-aware assertion is possible.
- [ ] Add or keep contracts for:
  - no glass/blur on main panels,
  - no neon primary action override,
  - no mono-uppercase as the default label style,
  - border/fill diet for low-priority controls.
- [ ] Add a small interaction-state pass:
  - list row hover,
  - selected rows,
  - overlay open/close timing,
  - focus-visible rings.
- [ ] Run `pnpm --filter @alfred/desktop test`.
- [ ] Run `pnpm --filter @alfred/desktop build`.

**Exit criteria:**
- Fewer override layers.
- Current visual direction is easier to maintain.
- CSS contracts still protect against neon green, glass, unreadable microcopy, and xterm remount risk.

---

## Out Of Scope Until Promoted

- Full layout redesign beyond Work / Inbox / History.
- Runner/API/backend changes.
- New IPC for pure visual work.
- Replacing xterm.
- Decorative hero/marketing surfaces.
- Analytics as a top-level nav item.

---

## Self-Review

**Spec coverage:** This plan consolidates the Fable audit findings, current Electron smoke observations, and active `ui-token-hierarchy` branch work into one tracked SSOT.

**Placeholder scan:** No `TBD`, `TODO`, or open-ended “fix later” tasks are used. Each phase names files, rules, commands, and exit criteria.

**Type consistency:** The plan does not introduce new runtime types or IPC. Proposed component names are confined to the future asset phase and do not affect current branches until that phase is explicitly started.
