# Phase J0 — Native Glass Rollout Receipt

**Status:** Observed, accepted, published
**Product rollout SHA:** `22bf219ad9138c26f5cfd2d5bcaf204ac76482dd`
**Published closeout SHA:** `3242fc7f0036626ee1ab0a67a88c366519d53826`
**Accepted calibration SHA:** `35444863be8956a829e7f9f5065062ccc61a3222`
**Date:** 2026-07-29

## Scope and lineage

`Alfred convergence roadmap → Phase J → J0 Visual Alignment → bounded native glass`

The final implementation enables the native material only on macOS and bounds
visible background influence to the titlebar and Projects. Work, terminal,
Preview, Sessions/Reader, Run details, Inbox, Context, Privacy, command UI,
dialogs, alerts, and crash recovery retain opaque owners. Non-macOS keeps the
opaque fallback.

The accepted target-macOS path uses `transparent: true`. This supersedes the
earlier no-transparent fail-closed decision because the replacement was directly
shown with working resize and native shadow and Patryk accepted the result.

## Visual and product evidence

- Computer Use inspected the final rebuilt Electron window after the last
  material-intensity change. The returned app state loaded
  `index.html?alfred-window-material=native`, exposed native traffic lights and
  the final Projects/Work hierarchy, and an emitted screenshot showed the Work
  and terminal surfaces remaining visually opaque.
- The live instance was raised over the controlled colored background. Patryk
  directly viewed the production material, requested a stronger influence, and
  accepted the final calibration on 2026-07-29 with `akceptuje`.
- Final material fills are `rgba(3, 5, 8, 0.30)` for the titlebar and
  `rgba(3, 5, 8, 0.36)` for Projects. Both retain blur `24px`, saturation
  `1.22`, and active native material; Projects remains slightly darker.
- Direct user screenshots showed the background color influencing titlebar and
  Projects while Work remained opaque. The native shadow and manual resize were
  visible in the accepted target setup.

**Visual evidence: Observed — surface: Computer Use; proof:** the completed
post-change `get_app_state` event returned the final native-material URL and
window state, emitted the final Alfred screenshot, and the raised colored-
background instance received Patryk's explicit acceptance.

## Automated evidence

- The original rollout contract passed at `0.44` / `0.54`. The accepted
  post-closeout calibration passed its focused renderer contract at
  `0.30` / `0.36` (`106/106`).
- Desktop test suite: `61` files, `911/911` tests PASS.
- `pnpm verify:quality`: PASS on integrated local `main` at `22bf219`
  (ESLint, typecheck, tests, build).
- `pnpm smoke:electron`: PASS serially on integrated local `main`,
  Electron `42.0.0`, `15/15`.
- Native material scenario confirmed marker `native`, resizable window, native
  shadow, `[1120, 720]` minimum, translucent chrome owners, and opaque Work and
  terminal owners.
- Final diff review: `0 Critical / 0 Important / 0 Minor`.
- `git diff --check`: PASS.
- Post-push CI run `30385887045`: PASS (`quality` and `electron-smoke`).
- Post-calibration CI run `30403883952`: PASS on `3544486`.

One initial post-integration smoke was invalid because it raced the build and
started from the pre-build `dist`. No code change was made for that artifact
race; the required serial rerun after build passed `15/15`.

The first post-push CI run `30385391315` exposed a test-only environment gap:
the macOS runner requested `prefers-reduced-transparency`, so Alfred correctly
used its opaque accessibility fallback while the smoke test still required
alpha below one. `3242fc7` made the existing scenario assert the correct branch
for the active system preference without weakening the opaque Work/terminal
boundary. Local `verify:quality`, local Electron `15/15`, and the replacement
remote run all passed.

## Verdict

J0 native glass was rolled out at `22bf219`, closed at `3242fc7`, and its
stronger final calibration was accepted and published at `3544486`. J0 and
Phase J remain complete. Phase Z is next but has not started.
