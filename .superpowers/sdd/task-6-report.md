# Phase E Task 6 — real terminal keep-alive and geometry

## Status

BLOCKED. The real Electron scenario proves PTY output, xterm DOM identity, hidden-tile mounting, Focus/Split/Grid behavior, Grid restoration, narrow-width containment, UI terminal shutdown, and clean process cleanup. It also consistently exposes a production geometry contract failure: `desk-runtime-surface` is 8 px shorter than `workbench-surface` (required delta `<= 2`) at both the initial window size and 1120×720. Per the Phase E brief, no production CSS or renderer behavior was changed.

## RED and systematic debugging evidence

1. First runtime RED stopped during harness setup. Electron returned `/private/var/.../user-data`, while the fixture created the same path through macOS's `/var/...` symlink. Root cause was textual comparison of equivalent paths; existing terminal-manager tests confirmed the repository pattern of comparing `fs.realpath` results.
2. After canonical-path comparison, the scenario reached geometry and failed with `stageHeightDelta: 8`. The same run exposed Task 5 teardown defects: pointer hit-testing reported `.tile-actions` intercepting the public Close button, and Playwright's own inspector shutdown notice was classified as unexpected main stderr.
3. Keyboard activation of Close was tested as a minimal hypothesis and rejected: the tile count remained 3. Public `click({ force: true })` on the same role-addressed Close button invokes the real UI handler while bypassing the broken pointer hit-test; all three tile counts then decremented and cleanup became clean.
4. The inspector exception is an exact localhost/port/UUID/two-line regex with negative unit coverage for suffixes and non-localhost URLs. No general stderr relaxation was added.
5. Final focused RED has only the production geometry assertion. Trace, screenshot, logs, cleanup JSON, and the attached `terminal-geometry.json` are under `output/playwright/terminal-core-flow-termina-703ad-l-xterm-and-layout-geometry/`.

## Runtime proofs before the blocking assertion

- A unique `ALFRED_E2E_<uuid>` marker was written through the visible `Terminal input` textbox to a real zsh PTY and observed in the first real `xterm-host`.
- Three live terminal tiles existed. The original terminal tile, xterm host, and `.xterm-screen` remained the same connected DOM nodes across Work → Inbox → History → Work.
- The marker remained in the same xterm host after surface navigation and after layout changes.
- Focus kept two tiles mounted with `aria-hidden=true`; Split kept one mounted with `aria-hidden=true`; Grid restored all three with zero hidden tiles. The first xterm host remained the same node throughout.
- All three active terminals were closed through their public role-addressed Close controls before application shutdown.
- Renderer output contained only the exact allowlisted Electron 42 development CSP warning. Main output contained only Playwright/Electron's exact allowlisted inspector shutdown notice. There were zero unexpected page, renderer, main stdout, or main stderr messages.

## Geometry evidence

| Measurement | Initial | 1120×720 | Contract |
|---|---:|---:|---:|
| `stageHeightDelta` | 8 | 8 | `<= 2` — **FAIL** |
| `hostWidth` | 530.5 | 382.5 | `> 0` — pass |
| `hostHeight` | 510 | 510 | `> 0` — pass |
| `tileBottomOverflow` | -204 | -4 | `<= 2` — pass |
| `documentOverflow` | 0 | 0 | `<= 0` — pass |

The failure is relational and repeatable; it is not a selector or harness timing failure. The test uses `BrowserWindow.setBounds`, never `page.setViewportSize`, and contains no sleep, retry, private Playwright helper, or production hook.

## Cleanup and PID evidence

Final `cleanup-status.json`:

```json
{
  "mainPid": 48226,
  "descendants": [48235, 48236, 48238],
  "alive": [],
  "closeResult": "closed",
  "descendantDiscoveryError": null,
  "requiredSignalFallback": false,
  "usedSigkill": false,
  "clean": true,
  "uiCleanupError": null
}
```

The post-run process check found no process containing the fixture prefix `alfred-electron-`. It did find Patryk's unrelated real Alfred renderer using `/Users/patryk/Library/Application Support/@alfred/desktop`; it was not touched.

## Harness fixes

- Canonicalize both sides of the isolated `userData` assertion with `realpath`.
- Exactly allowlist Playwright's expected Electron inspector shutdown notice, with pure unit tests.
- Force-click the real accessible Close button during teardown to bypass production layer hit-testing; still assert the tile count after each UI action.

## Verification

- `pnpm --filter @alfred/desktop exec vitest run e2e/support/electron-harness-pure.unit.test.ts` — PASS, 3/3.
- `pnpm --filter @alfred/desktop smoke:electron -- --grep "terminal core flow"` — BLOCKED, 0/1; only failure is `stageHeightDelta: 8` versus `<= 2`.
- Targeted strict harness/spec TypeScript command from `apps/desktop` — PASS.
- `pnpm lint` — PASS, zero warnings.
- `pnpm --filter @alfred/desktop typecheck` — PASS.
- `pnpm --filter @alfred/desktop build` — PASS; only the existing Vite chunk-size advisory.
- `git diff --check` — PASS.

## Files and concerns

- Added `apps/desktop/e2e/terminal-core-flow.spec.ts`.
- Updated `apps/desktop/e2e/support/electron-app.ts`.
- Updated `apps/desktop/e2e/support/electron-harness-pure.ts` and its unit test.
- This report is committed alongside the scenario and harness evidence.
- Production geometry remains intentionally unfixed pending coordinator/human approval. A production fix should explain the exact 8 px relationship rather than widening the test threshold.
