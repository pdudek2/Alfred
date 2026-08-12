# Task 2 Report

## Status

- Branch: `terminal-layout-smoothing`
- Commit: `849c656` (`Integrate three-pane desk grid`)

## Follow-up fix

- Review surfaced an Important regression on Wednesday, August 12, 2026:
  staged `Arrange` placement broke because the new wrapper around `StagedTilePreview`
  became the direct `.terminal-grid` child without carrying the inline `gridStyle(layout, preview)`.
- Fix approach:
  moved the arrange layout/preview style onto the direct staged wrapper in `TerminalDesk`
  and stopped passing duplicate `layout` / `preview` props into nested `StagedTilePreview`.

## Files

- Modified: `apps/desktop/src/renderer/components/TerminalDesk.tsx`
- Modified: `apps/desktop/src/renderer/components/WorkSurfaceToolbar.tsx`
- Modified: `apps/desktop/src/renderer/components/WorkSurfaceToolbar.test.tsx`
- Added: `apps/desktop/src/renderer/components/terminal-desk-layout.css`
- Added: `apps/desktop/e2e/terminal-layout-smoothing.spec.ts`

## RED

### 1. Toolbar unit regression

Command:

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/WorkSurfaceToolbar.test.tsx
```

Observed RED before implementation:

- `caps normal Grid session count at three visible sessions`
- Expected: `3 visible sessions`
- Received toolbar text with `5 visible sessions`

### 2. Electron regression

Command:

```bash
pnpm --filter @alfred/desktop exec playwright test --config playwright.config.ts e2e/terminal-layout-smoothing.spec.ts
```

Observed RED before implementation:

- After adding three manual terminals, normal Grid still rendered `4` visible tiles
- Expected `locator('[data-testid="terminal-tile"]:visible')` count: `3`
- Received: `4`

Note:

- The first Playwright RED attempt hit a harness setup timeout.
- A second run reproduced the intended product failure deterministically, so implementation proceeded from the real RED.

### 3. Build before browser verification

Command:

```bash
pnpm build
```

Result before implementation:

- Passed, which confirmed the RED state came from behavior, not a broken build.

## GREEN

Commands:

```bash
pnpm build
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/WorkSurfaceToolbar.test.tsx
pnpm --filter @alfred/desktop exec playwright test --config playwright.config.ts e2e/terminal-layout-smoothing.spec.ts
```

Observed GREEN:

- `pnpm build`: passed
- Toolbar test file: `1 passed (1)` file, `4 passed (4)` tests
- Playwright regression: `1 passed (1)`

Follow-up GREEN after the staged Arrange fix:

```bash
pnpm build
pnpm --filter @alfred/desktop exec playwright test --config playwright.config.ts e2e/terminal-layout-smoothing.spec.ts
```

- `pnpm build`: passed
- `terminal-layout-smoothing.spec.ts`: `2 passed (2)`

## Behavior change summary

- Normal Work Grid in desk mode now presents at most three visible sessions.
- The visible trio is derived per workspace with Task 1 helper ordering, so selection can promote a hidden session into the primary slot immediately.
- Hidden overflow tiles stay mounted, remain inert, and keep their existing xterm hosts attached.
- The toolbar now reports a truthful visible count for normal Grid by capping the display at three while leaving Focus, Split, and Arrange semantics unchanged.
- Arrange mode still exposes all sessions, and the all-staged desk list still bypasses the three-pane presentation.

## Self-review

- Kept the change inside the Task 2 file allowlist.
- Reused the Task 1 helper instead of re-implementing ordering logic.
- Preserved stable React keys and xterm mounting by hiding overflow tiles instead of removing them.
- Added only the requested component-scoped CSS selectors instead of touching global `styles.css`.

## Validation performed

- Verified the exact user flow from the brief: add three more terminals, confirm four mounted tiles, three visible tiles, one each of `primary`, `secondary`, `tertiary`, and toolbar text `3 visible sessions`.
- Verified the high-risk transition where a hidden project session is selected and becomes `primary` without replacing any of the four mounted xterm hosts.
- Verified no obvious accessibility regression on the changed path by keeping hidden overflow tiles `aria-hidden`, non-focusable, and inert.
- Added a focused staged Arrange regression that proves the direct `.terminal-grid` child wrapping `fixture-item-1` keeps `gridColumn: 1 / span 12` and `gridRow: 1 / span 8` after entering `Arrange`.

## Concerns / residual risk

- Staged tiles cannot receive the slot attribute directly without editing `staged-tile.tsx`, which was outside the Task 2 allowlist. To stay within scope, the slot is applied on the staged tile wrapper in `TerminalDesk`.
- Focused validation covered the new desk path only. Broader integration confidence for unrelated Work surface flows still depends on the larger suite outside this task.
