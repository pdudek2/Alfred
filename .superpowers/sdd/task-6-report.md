# Task 6 Phase G — final gate and closeout evidence

Date: 2026-07-12
Worktree: `/Users/patryk/Desktop/Alfred/.worktrees/phase-g-css-sanitation`
Branch: `phase-g-css-sanitation`
Base: `c8aec57`
Final audited HEAD: `55e2b0fab9388fa5661b38e3755a511d4188d14f`
Range: `c8aec57...55e2b0f` (21 commits)

## Status

**COMPLETE — Phase G final gate is green and the whole-branch review is approved.**

Final evidence on `55e2b0f`:

- fresh root `pnpm verify`: PASS;
- lint and typecheck: PASS;
- root tests: 34/34;
- all package tests: 823/823, including desktop 652/652 in 49 files;
- build: PASS, with only the known Vite chunk-size advisory;
- Electron smoke: 4/4;
- strict DPR2 CSS evidence: 1/1;
- final supplemental base/final extended evidence JSON: byte-identical, SHA-256 `5038f9dd93894f452c870ae039790c0e100046c1968bfacbc3fc5dd98e9c3fd1`;
- all 11 screenshot pairs reviewed; no geometry, component-style, typography, color, scroll-owner, or layout drift;
- xterm host and screen node identity, buffer marker, terminal input, and runtime-error assertions: PASS;
- whole-branch review: Ready, no Critical/Important/Minor findings.

The original blocked gate below is retained as historical diagnostic evidence. It led to the tracked fixes for macOS window placement, command-palette readiness, Inbox action cascade, duplicate owner detection, two flaky test preconditions, selective privacy masking, responsive owner coverage, deterministic viewport/hover/transition readiness, and the workspace-title cascade regression. The authoritative baseline and geometry tolerance were never weakened or overwritten.

Evidence directories:

- authoritative baseline: `docs/audits/local-artifacts/2026-07-11-phase-g-css-sanitation/baseline/`;
- strict final: `docs/audits/local-artifacts/2026-07-11-phase-g-css-sanitation/review-fix-dpr2-v5/`;
- provenance-locked extended base: `docs/audits/local-artifacts/2026-07-11-phase-g-css-sanitation/rereview-base-extended/`;
- provenance-locked extended final: `docs/audits/local-artifacts/2026-07-11-phase-g-css-sanitation/rereview-final-extended/`.

One separate pre-existing product finding remains deferred outside Phase G: a terminal can exit after `terminal.list()` but before the renderer registers its unbuffered exit listener. Fixing it requires an atomic subscribe/reconcile lifecycle design; the test-only listener precondition is correct for the announcement test but does not claim to fix the product race.

## Historical initial blocked gate

## 1. Branch scope and ownership audit

Fresh commands before writing this report:

```text
git status --short
# no output (tracked worktree clean)

git rev-list --count c8aec57..HEAD
# 12

git diff --check c8aec57...HEAD
# no output; exit 0
```

Commit list, newest first:

```text
429f20d test(desktop): harden orphan selector boundaries
eae7ff1 refactor(desktop): remove proven orphan css
17220d6 test(desktop): cover surface css state owners
c4ac14f refactor(desktop): consolidate surface css ownership
2edf3e6 refactor(desktop): enforce css owner regions
b58f9a9 refactor(desktop): colocate css state owners
d323d57 refactor(desktop): consolidate terminal css ownership
bb2a01e test(desktop): pin CSS evidence display scale
9bb7c1f test(desktop): harden css ownership contexts
a6047b7 fix(desktop): localize shell css state owners
6e85fce refactor(desktop): consolidate shell css ownership
6f2e412 test(desktop): capture css ownership evidence
```

Diff stat:

```text
 apps/desktop/e2e/css-layout-ownership.spec.ts      |  272 ++
 apps/desktop/e2e/support/css-layout-evidence.ts    |  288 ++
 .../e2e/support/css-layout-evidence.unit.test.ts   |   56 +
 apps/desktop/e2e/support/display-placement.ts      |   44 +
 .../e2e/support/display-placement.unit.test.ts     |   39 +
 apps/desktop/src/renderer/styles-contract.test.ts  |  858 +++-
 apps/desktop/src/renderer/styles.css               | 4883 ++++++++------------
 7 files changed, 3324 insertions(+), 3116 deletions(-)
```

Tracked names:

```text
apps/desktop/e2e/css-layout-ownership.spec.ts
apps/desktop/e2e/support/css-layout-evidence.ts
apps/desktop/e2e/support/css-layout-evidence.unit.test.ts
apps/desktop/e2e/support/display-placement.ts
apps/desktop/e2e/support/display-placement.unit.test.ts
apps/desktop/src/renderer/styles-contract.test.ts
apps/desktop/src/renderer/styles.css
```

The two files beyond the brief's abbreviated expected list are explained by commit `bb2a01e`: `display-placement.ts` selects an exact-DPR display work area, and its unit test covers selection/failure/invalid-scale behavior. They belong to the deterministic evidence harness, not product behavior. The present full-gate failure shows that this support is only activated when `ALFRED_CSS_TARGET_SCALE_FACTOR` is explicitly set; default `pnpm verify` remains red on this display arrangement.

## 2. Residue and owner-test audit

```text
rg -n 'v12|final override|cleanup override|last wins|last-block-wins' apps/desktop/src/renderer/styles.css
# 0 matches

rg -n 'matches\.at\(-1\)|return matches\.at\(-1\)' apps/desktop/src/renderer/styles-contract.test.ts
24:  return matches.at(-1)?.groups?.body ?? "";
52:  return matches.at(-1)?.groups?.body ?? "";
262:  const match = matches.at(-1);
```

The three retained last-match reads are legacy convenience helpers (`blockFor`, `exactBlockFor`, `ruleForSelectorContaining`) used for effective-rule/non-ownership checks. Core Phase G ownership uses explicit helpers that assert total occurrence counts and region membership: `expectCanonicalBase`, `expectTopLevelOwnerWithin`, `expectTopLevelDeclarationOwnerWithin`, `expectAllTopLevelOccurrencesWithin`, and family-wide occurrence scans. The contract includes negative fixtures proving a late selector outside its owner region fails. Fresh desktop results include `styles-contract.test.ts`: 76/76 passed. No core owner relies solely on last-match semantics.

## 3. Strict DPR2 evidence

The brief's literal command without the DPR variable was first run and failed before completing evidence: requested narrow bounds `{x:0,y:0,width:1120,height:720}`, received `{x:0,y:30,width:1120,height:720}` after 15 seconds.

The branch's locked strict-DPR2 command was then run:

```text
ALFRED_CSS_TARGET_SCALE_FACTOR=2 \
ALFRED_CSS_BASELINE_DIR=../../docs/audits/local-artifacts/2026-07-11-phase-g-css-sanitation/baseline \
ALFRED_CSS_EVIDENCE_DIR=../../docs/audits/local-artifacts/2026-07-11-phase-g-css-sanitation/final \
pnpm exec playwright test e2e/css-layout-ownership.spec.ts --config playwright.config.ts

Running 1 test using 1 worker
1 passed (4.4s)
```

Result: all 11 protected states captured at DPR2; strict computed-style and geometry comparison returned zero mismatches. The JSON files are byte-identical:

```text
baseline/css-layout-evidence.json  sha256 297eafd796d40093e538786a9991be1588eed6786eebc086e2298ada5cbf55d8
final/css-layout-evidence.json     sha256 297eafd796d40093e538786a9991be1588eed6786eebc086e2298ada5cbf55d8
```

The passed spec also proves the original xterm host and `.xterm-screen` node identity through Focus, Split, Grid restoration, Arrange, Inbox, Observatory, Work restoration, Context, and narrow; the marker remains in the terminal buffer, and the harness reports no runtime/page errors. The final smoke logs contain only the known development CSP warning in the renderer; no xterm exception or unhandled renderer error was found.

Final evidence directory:

`docs/audits/local-artifacts/2026-07-11-phase-g-css-sanitation/final/`

Artifact SHA-256:

```text
arrange.png               97c91c2dd8e2891a5d5895532c25a740953155ef2ff198ff134df8e4ee40d104
command-palette.png       fb27a940cd59c4eb4e0c350afbcbfb4e144b2e00cd0c1abfcf8ac63a9387ee34
context.png               743116e5f46fc9587855709751f909c3579c73d88b2bcaebf8d9cc7161f34606
css-layout-evidence.json  297eafd796d40093e538786a9991be1588eed6786eebc086e2298ada5cbf55d8
focus.png                 7b0ff762f7acfcae31f336b2f897b6eb20644d68036c827d90c80e3308be8669
inbox.png                 b2ea405ad7fa92daf20af7b412a23b79686f014e5b4894436242e24d3ae7c147
narrow.png                e1faf1ba103a77ff7417f55222df1ce9bb4e0a7cba15649b4e247a03f347fe41
observatory.png           6b67e5c571e265677aefacfdd647a522717740713df142a008128d63ab1b36c8
privacy.png               eab22da5e3fa626c0c51dc6f49a133fcae7775a3e35648089d3795e8dd771620
session-quick-switch.png  dd1598a4fd5a51ba5aa03cb6158203b20b57a2f3f2d86234fd5e7fe27ac8d990
split.png                 5b0f029e1d54265fc92a9f3df6ea915a81f7177da72a6aab33e615b01acae2f3
work-grid.png             d375e650c7d52d734ec7a10411fa16ff22ed862ef242aa828ba2413f7fdc5791
```

## 4. Manual privacy-safe screenshot review

All 11 baseline/final pairs were inspected. Coordinates are DPR2 image pixels. Contact sheets are ignored evidence only:

```text
manual-review-1.png  8261e67fcebaadf521d37648f4f28a65804cd7284f2c0119c4dc93d0538243d1
manual-review-2.png  0f7b36ebe7a58b8d3a5f3c53d9fb85f8a17e750047bae92a99f3e2dbaee0e6ef
manual-review-3.png  aae6ba4eb4fc0423511546414af726fa82992e26ec77f14f7c2a877d09d7ea77
```

Exact per-state verdicts:

| State | Verdict |
| --- | --- |
| work-grid | rasterization-only difference, with coordinates/reason — changed-pixel envelope `(278,30)–(2806,1652)` follows aligned chrome, borders and xterm cursor/paint edges; protected JSON is byte-identical and no geometry silhouette moved |
| focus | rasterization-only difference, with coordinates/reason — envelope `(278,30)–(2824,116)` is confined to aligned top-chrome paint/antialiasing; protected JSON is byte-identical |
| split | rasterization-only difference, with coordinates/reason — envelope `(278,30)–(2824,227)` follows aligned top chrome/tile header and cursor edges; protected JSON is byte-identical |
| arrange | rasterization-only difference, with coordinates/reason — envelope `(278,30)–(2824,1692)` is dispersed over aligned borders/grid/cursor painting with no visible geometry displacement; protected JSON is byte-identical |
| inbox | blocked — functional or visual drift found — within overall envelope `(278,30)–(2824,497)`, the Inbox card/action area around `(1690,290)–(1866,340)` has a visibly different control/selection paint state; not defensibly rasterization-only |
| observatory | rasterization-only difference, with coordinates/reason — envelope `(278,30)–(2824,116)` is confined to aligned top-chrome paint/antialiasing; protected JSON is byte-identical |
| context | rasterization-only difference, with coordinates/reason — envelope `(278,30)–(2824,1355)` follows aligned chrome, panel and cursor edges; no visible geometry shift and protected JSON is byte-identical |
| narrow | rasterization-only difference, with coordinates/reason — envelope `(975,47)–(2184,227)` is confined to aligned top/tile-header and cursor paint; protected JSON is byte-identical |
| command-palette | blocked — functional or visual drift found — within envelope `(278,30)–(2824,1778)`, the focused/selected option around `(553,290)–(1382,361)` is strongly filled and outlined in baseline but effectively unpainted in final; not defensibly rasterization-only |
| privacy | rasterization-only difference, with coordinates/reason — envelope `(278,30)–(2824,1778)` follows aligned overlay/chrome shadows and antialiasing; panel geometry and protected JSON are identical |
| session-quick-switch | rasterization-only difference, with coordinates/reason — envelope `(278,30)–(2824,1778)` follows aligned overlay/chrome paint edges; panel geometry and protected JSON are identical |

Because two states are `blocked`, the zero-intentional-visual-change decision cannot be recorded.

## 5. Full root verification

Fresh `pnpm verify` on HEAD `429f20d`:

```text
ESLint: PASS (`eslint . --max-warnings 0`)
typecheck: PASS, 9/9 Turbo tasks (8 cached, desktop fresh)
root Node tests: PASS, 34/34
package tests: PASS
  adapters 2/2
  api 64/64
  db 1/1
  schema 31/31
  runner 73/73
  desktop 645/645 in 49 files
total unit/integration assertions: 850 passed, 0 failed
build: PASS, 6/6 Turbo tasks; desktop fresh, 1772 modules transformed
Electron smoke: FAIL, 3 passed / 1 failed (26.7s)
overall pnpm verify: FAIL, exit 1
```

Failing Electron assertion:

```text
css-layout-ownership.spec.ts:99:1
expected window bounds { x: 0, y: 0, width: 1120, height: 720 }
received               { x: 0, y: 30, width: 1120, height: 720 }
Timeout 15000ms in setWindowSize() at line 264
```

The other Electron scenarios passed: Inbox long-queue scroll/action plus Observatory return, terminal core-flow xterm/layout geometry, and workspace switch runtime identity.

## 6. Warning inventory

Nonblocking known warnings observed:

- Vite/Rolldown advisory: renderer JS chunk `708.82 kB` exceeds the `500 kB` advisory threshold.
- Playwright/Node: `NO_COLOR` ignored because `FORCE_COLOR` is set.
- Electron development renderer: insecure/unsafe-eval Content Security Policy warning; explicitly says it does not appear in the packaged app.
- Inspector shutdown is logged under `[main-stderr/error]` as `Debugger ending on ws://...`; this is harness teardown, not an application runtime exception.
- Turbo replayed cache logs for five unaffected packages from the shared worktree cache (paths mention `phase-e-quality-gate`); desktop typecheck/test/build were fresh cache misses on this worktree.

Blocking items are not categorized as warnings: the CSS Electron scenario failure and the two screenshot verdicts above.

## 7. Findings disposition and owner-map status

- **F7:** implementation evidence supports canonical base/state/responsive owner regions and no new late override layer; explicit occurrence/region contracts pass. Final disposition remains **not promoted / closeout blocked** until the root gate and screenshot review are green.
- **F9:** **resolved** remains supported. `.inbox-section-stack` is the sole scroll owner; the fresh `inbox-observatory` Electron scenario passed long-queue scroll, a real action, and Observatory return.
- **F12:** implementation evidence supports resolution for 11 removed selectors, each with static consumer, builder, 12-state Electron DOM, and test/fixture proof. Seventy-four suspects remain intentionally kept with a named missing proof: dynamic-builder disproof, external/runtime consumer proof, explicit review/modal/error/empty/recovery state proof, empty-workspace state proof, or recovery-state proof. Final disposition remains **not promoted / closeout blocked**.

Current ignored `owner-map.md` contains the slice owner tables, F12 four-proof ledger, and KEEP reasons, but it was not rewritten as final because the final gate is red. The canonical roadmap at `/Users/patryk/Desktop/Alfred/docs/audits/local-plans/2026-07-10-alfred-convergence-audit-and-plan.md` still records F7/F12 as deferred and was intentionally not updated.

## 8. Final repository state and handoff

```text
git status --short
 M .superpowers/sdd/task-6-report.md
```

Ignored artifacts added/updated: `final/*` and the contact sheets. The only tracked worktree modification is this required report. No implementation file changed, and no commit, merge, push, branch cleanup, baseline regeneration, tolerance update, roadmap closeout, owner-map closeout, or memory save was performed.

Required next action belongs to the controller/review flow: investigate the default smoke display-placement activation and the two screenshot-state differences as concrete findings, make any approved tracked change in a subsequent task, then rerun strict DPR2 evidence, all 11 manual verdicts, and full root `pnpm verify` before declaring Phase G complete.

## 9. Post-blocker diagnostic fix (pending independent review and fresh full verify)

Systematic diagnosis separated the original blockers into three root causes:

- Default bounds were a harness regression from `bb2a01e`: the pre-change helper matched only `width` and `height`, while the new helper matched `x` and `y` even without an explicit DPR target. macOS legally clamped the narrow window from `y=0` to `y=30`.
- Command-palette paint was a React effect race, not mouse hover. Three instrumented runs on the same HEAD captured the search input focused and no option hovered, but the first option alternated between `class="active" aria-selected="true"` and no active/selected state. Two uninstrumented same-HEAD runs also produced different palette PNG hashes.
- Inbox paint was a real CSS cascade regression. Both base and HEAD had the Inbox section focused and its action neither hovered nor focused, but controlled base-CSS injection showed different effective action values because consolidation moved the standalone `.review-surface-primary` owner after the shared control rule.

The approved minimal tracked correction:

- restores width/height-only matching by default and keeps exact bounds plus DPR matching when `ALFRED_CSS_TARGET_SCALE_FACTOR` is set;
- waits for exactly one selected command-palette option before evidence capture;
- removes the late standalone Inbox primary-action override so the existing shared control owner wins again, without adding another CSS layer.

TDD evidence:

```text
RED: 3 focused failures / 83 passes
  missing default-vs-strict bounds expectation
  missing command-palette capture readiness
  Inbox effective owner still cyan instead of the base dark shared control

GREEN: 3 files, 86/86 tests
desktop typecheck: PASS
desktop build: PASS (known chunk-size advisory only)
default CSS Electron spec: PASS
strict DPR2 CSS Electron spec: PASS twice after the fresh build
strict evidence JSON: byte-identical to baseline, SHA-256 297eafd796d40093e538786a9991be1588eed6786eebc086e2298ada5cbf55d8
```

Controlled Inbox computed proof after the fix was byte-for-byte equal between current CSS and an injected `c8aec57` stylesheet for the action's background, border color, box shadow, text color, height, and padding. The values included dark `oklab(0.132702 -0.00273806 -0.00692364)`, `rgba(176, 188, 201, 0.12)`, `none`, `rgb(201, 210, 219)`, `32px`, and `0px 10px`.

For command palette, the two post-fix strict captures had zero differing pixels across the central palette region `(800,400)-(2200,900)`, while the blocked final capture differed from baseline by 128,174 pixels in the same region. Remaining full-frame differences were outside that region and continue to match the known chrome/xterm rasterization noise described above.

One repeat strict attempt failed before any CSS state capture because a newly requested terminal did not mount and cleanup required the existing SIGKILL fallback. The immediately preceding and following strict runs passed, and this symptom also occurred once before the tracked correction. It is retained as a separate harness/runtime observation rather than attributed to the CSS fix.

This section is evidence only. It must not be included in the focused fix commit. Phase G remains pending independent review and a fresh root `pnpm verify`.
