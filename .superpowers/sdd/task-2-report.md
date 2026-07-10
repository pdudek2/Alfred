# Phase E Task 2 — ESLint flat config and mechanical lint baseline

## Status

Implemented the requested ESLint flat configuration, a complete desktop ESLint TypeScript project, and only the mechanical lint fixes authorized by the task brief. The quality baseline is intentionally RED with exactly the nine behavior-sensitive findings assigned to Task 3.

## Starting point and RED audit

- Worktree: `/Users/patryk/Desktop/Alfred/.worktrees/phase-e-quality-gate`
- Starting HEAD: `a47743d fix: preflight Electron before desktop smoke`
- Initial worktree state: clean.
- RED command: `pnpm lint 2>&1 | tee /tmp/alfred-phase-e-eslint-red.log`
- Result: expected failure from ESLint (`ELIFECYCLE`, 20 errors, 0 warnings) across 15 source files, below the 30-source-file stop condition.
- The tee pipeline itself returned status 0 while preserving the ESLint failure output; the nested `pnpm lint` output clearly reported exit code 1.

Exact initial findings:

- 6 `@typescript-eslint/no-unused-vars`:
  - `desktop-state-ipc.test.ts`: `createPersistedDesktopStateStore`
  - `main.ts`: `QUIT_GUARD_CONFIRM_BUTTON`
  - `app.test.tsx`: `tile`
  - `app.tsx`: `uniqueWorkspaceId`
  - `AlfredControlRail.tsx`: `sessions`
  - `session-state.ts`: `SessionActivityEventKind`
- 2 `preserve-caught-error`: `git-worktree.ts`, `terminal-manager.ts`
- 2 `no-control-regex`: `preview-state.ts`, `session-activity.ts`
- 1 `no-unexpected-multiline`: `workspace-path-matching.ts`
- 4 `react-hooks/exhaustive-deps`: two in `app.tsx`, one in `CommandPalette.tsx`, one in `TerminalDesk.tsx`
- 1 `@typescript-eslint/no-floating-promises`: `main.ts`
- 4 `@typescript-eslint/switch-exhaustiveness-check`: one in `app.tsx`, two in `AgentTimelinePanel.tsx`, one in `workspace-attention.ts`

This is 15 untyped findings across 13 files plus 5 typed findings, matching the preflight shape in the brief.

## Changes

- Added `eslint.config.mjs` exactly with:
  - generated/build/audit/worktree ignores from the brief;
  - JavaScript recommended rules for scripts/config files;
  - TypeScript recommended rules and underscore-aware unused-variable handling;
  - the six typed projects and four selected typed rules;
  - React Hooks rules for the desktop renderer;
  - the specified test/declaration overrides.
- Added `apps/desktop/tsconfig.eslint.json` with desktop source, main tests, Vite, Playwright, and E2E coverage; no `allowDefaultProject`.
- Removed only genuinely unused imports, variables, function, and prop plumbing listed in the brief.
- Preserved caught errors using `new Error(message, { cause: error })` in both required locations.
- Parenthesized the workspace match chain to remove ambiguous newline property access.
- Added narrowly scoped `no-control-regex` disables immediately above the two intentional terminal ESC regexes, with runtime-protocol justification.
- Did not change Task 3 hook, Promise, or exhaustiveness behavior.

## Verification and TDD/audit evidence

1. RED audit after adding config and before source fixes:
   - `pnpm lint 2>&1 | tee /tmp/alfred-phase-e-eslint-red.log`
   - Expected RED: 20 errors, 0 warnings, 15 files.
2. Post-mechanical baseline:
   - `pnpm lint`
   - Expected RED: exactly 9 errors, 0 warnings, 6 files.
   - Remaining: 4 Hooks, 1 Promise, 4 exhaustiveness findings.
   - Confirmed absent: unused variables, parsing errors, generated output, `preserve-caught-error`, `no-control-regex`, and `no-unexpected-multiline`.
3. Focused regression:
   - `pnpm --filter @alfred/desktop exec vitest run src/main/git-worktree.test.ts src/main/terminal-manager.test.ts src/renderer/preview-state.test.ts src/shared/session-activity.test.ts src/renderer/workspace-path-matching.test.ts --maxWorkers=1`
   - PASS, exit 0: 4 files passed, 85 tests passed.
4. Type safety:
   - `pnpm --filter @alfred/desktop typecheck`
   - PASS, exit 0: renderer and main TypeScript projects.
5. Hygiene:
   - `git diff --check`
   - Initially exposed one trailing space introduced during patching; removed before commit and rerun for final verification.

## Files

Created:

- `eslint.config.mjs`
- `apps/desktop/tsconfig.eslint.json`

Mechanically modified:

- `apps/desktop/src/main/desktop-state-ipc.test.ts`
- `apps/desktop/src/main/git-worktree.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/main/terminal-manager.ts`
- `apps/desktop/src/renderer/app.test.tsx`
- `apps/desktop/src/renderer/app.tsx`
- `apps/desktop/src/renderer/components/AlfredControlRail.tsx`
- `apps/desktop/src/renderer/preview-state.ts`
- `apps/desktop/src/renderer/session-state.ts`
- `apps/desktop/src/renderer/workspace-path-matching.ts`
- `apps/desktop/src/shared/session-activity.ts`

## Remaining Task 3 lint findings

- `@typescript-eslint/no-floating-promises` (1): `apps/desktop/src/main/main.ts:121`
- `react-hooks/exhaustive-deps` (4): `app.tsx:627`, `app.tsx:1378`, `CommandPalette.tsx:429`, `TerminalDesk.tsx:1298`
- `@typescript-eslint/switch-exhaustiveness-check` (4): `app.tsx:3140`, `AgentTimelinePanel.tsx:851`, `AgentTimelinePanel.tsx:867`, `workspace-attention.ts:97`

## Self-review

- Scope is limited to the two new configuration files and the exact mechanical findings reported by RED.
- No blanket rule disables, formatting rules, architecture changes, CSS, docs/audits, README, lockfile, IPC redesign, or Phase F–I behavior were introduced.
- Local regex disables are adjacent to the intentional terminal-protocol patterns and include a runtime reason.
- Both replacement errors preserve the original user-facing message and attach the caught value as `cause`.
- Removal of the unused test variable retains the awaited query, so test synchronization is unchanged.
- Removal of the unused `sessions` prop changes only dead prop plumbing; the active recovery session remains identical.
- No push performed and no AI attribution added.

## Concerns

- The brief's focused Vitest command names `src/renderer/workspace-path-matching.test.ts`, but that file does not exist at this HEAD. Vitest accepted the mixed path list and ran the four existing files successfully (85 tests). No new test was invented because the task explicitly limits changes to reported mechanical findings.
- Full lint intentionally remains RED until Task 3 resolves the nine behavior-sensitive findings above.
