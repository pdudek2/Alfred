# Phase J0 — Visual Alignment

> **Archival status (2026-08-01):** completed and retained at its original path
> for project-memory v2 provenance. It is not the active product contract; the
> canonical owner is
> `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`.
> Referenced local scratch and screenshot receipts may have been retired after
> their accepted outcomes were preserved inline.

> **Status:** complete. Patryk approved the
> contract on 2026-07-23. Slice 1 is integrated at `28f9d2a`, Slice 2 at
> `e136ad0`, Slice 3 at `de50789`, and Slice 4 at `750cb93`; the final
> post-integration native-window receipt is Observed and green. Mandatory Phase J
> dogfooding passed at `d8042c7`. The product-wide consistency/accessibility
> pass is complete at `786d21e`. Bounded native glass is accepted at `22bf219`
> and published with a test-only CI closeout at `3242fc7`, with the receipt at
> `docs/audits/local-artifacts/2026-07-28-phase-j0-native-glass-rollout/OBSERVATION.md`.
> J0 and Phase J are complete; Phase Z is next and not started. This
> does not reopen visual discovery.

## Lineage

`Alfred convergence roadmap → Phase J → J0 Visual Alignment → mandatory Phase J dogfooding`

Phase I remains closed at `728c4f8`. J0 does not reopen Phase I and does not create a second product roadmap. It aligns the implemented shell with a newer, explicitly approved visual contract before the real-use gate starts.

## Goal

Bring Alfred's production UI to the approved modern macOS direction without changing its terminal-first information architecture, terminal lifecycle, persistence model, or existing surface responsibilities.

## Accepted contract

- Alfred remains terminal-first. Work is the dominant surface.
- The application uses a quiet, native-feeling macOS hierarchy rather than card-heavy or dashboard-like chrome.
- Window-owned chrome may use restrained material depth. Terminal, transcript, reader, and embedded preview content remain stable opaque surfaces.
- Product UI uses the system sans stack. Mono is reserved for terminal content, code, paths, URLs, timestamps, and keyboard hints.
- Operational labels and frequently used controls are at least 13 px and 32 px high respectively. Smaller type is limited to secondary captions.
- Status is communicated with text or a meaningful glyph. Decorative status dots are not used.
- Focus, Split, Grid, and Arrange retain their existing behavior. Grid keeps equal terminal tiles.
- Preview remains an on-demand, resizable right dock and never remounts xterm.
- At the native 1120 px minimum window width, opening Preview or Context gives the active work surface priority by compacting Projects. The production breakpoint is `max-width: 1180px`; widths below 1120 px are browser/mockup evidence only because Electron currently enforces `minWidth: 1120`.
- `Inbox` is the single product name. `Needs you` may remain an internal section label.
- Run details is integrated into Sessions: a side column when space permits and a reader replacement at narrow widths.
- No new dependency, theme framework, compatibility layer, or second CSS override layer is introduced.

## Material and native glass boundary

J0 first establishes the direction with CSS and the existing Electron window. The current untracked native-glass probe is a separate user-owned experiment and is not part of Slice 1.

Native vibrancy may be adopted only after a later real-Electron gate proves:

- readable chrome over both light and dark desktop backgrounds;
- stable terminal and preview opacity;
- acceptable contrast in inactive and focused windows;
- no regression in window startup, resize, focus, or screenshot-based smoke tests.

If the gate fails, the CSS material fallback remains the production implementation. No feature flag or compatibility layer is required merely to preserve the experiment.

## Slicing

### J0 Slice 1 — Work shell and Preview

- shared visual tokens and product typography rules;
- Workbench header, Projects navigator, Work toolbar, and terminal tile chrome;
- Preview header, status treatment, embedded-content boundary, and narrow responsive priority;
- removal of superseded rules in the same diff;
- no changes to xterm mounting, layout persistence, Preview persistence, or terminal IPC.

**Status:** complete and accepted at `28f9d2a`. Focused, full quality, build,
real-Electron smoke, and direct 1440×900/1120×720 observation passed. Preserved
evidence:
`docs/audits/local-artifacts/2026-07-23-phase-j0-slice-1-work-shell/OBSERVATION.md`.

### J0 Slice 2 — Sessions and integrated Run details

- compact labelled source and time selects;
- flat Conversations list and J0 typography/control sizing;
- integrated Run details inspector: adjacent at 1440×900 and Reader replacement
  at 1120×720;
- preserved Sessions data ownership, lifecycle behavior, and xterm identity.

**Status:** complete and published at `e136ad0`. Focused tests, full quality,
build, Electron smoke `12/12`, and direct 1440×900/1120×720 observation passed.
Preserved evidence:
`docs/audits/local-artifacts/2026-07-23-phase-j0-slice-2-sessions-run-details/OBSERVATION.md`.

### J0 Slice 3 — Inbox

- one global Inbox surface with no duplicated project rail;
- flat J0 presentation and product typography/control floors;
- preserved AttentionProjection, actions, Recovery safety, focus, and xterm
  ownership.

**Status:** complete and integrated locally at `de50789`. Full quality, build,
Electron smoke, and direct 1440×900/1120×720 observation passed. Preserved
evidence:
`docs/audits/local-artifacts/2026-07-23-phase-j0-slice-3-inbox/OBSERVATION.md`.

### J0 Slice 4 — Context dock and Local Data & Privacy

- fixed 318 px adjacent Context dock with Preview exclusivity;
- compact Projects priority at the native minimum width;
- flat 640 px Privacy modal with safe destructive flow and complete focus
  ownership;
- preserved terminal identity, background output, persistence, and privacy
  behavior.

**Status:** complete and integrated locally at `750cb93`.
`pnpm verify:quality` and Electron smoke `13/13` passed on merged `main`; final
review found no Critical, Important, or Minor issues. The required fresh
post-integration Computer Use receipt passed at 1440×900 and 1120×720. Receipt:
`docs/audits/local-artifacts/2026-07-23-phase-j0-slice-4-context-privacy/OBSERVATION.md`.

### Remaining J0 obligations

None. The product-wide consistency/accessibility pass completed at `786d21e`.
The bounded native-glass rollout completed and was accepted at `22bf219`.

Mandatory Phase J dogfooding is already complete at `d8042c7`; it does not
replace the separate product-wide pass now recorded above.

Each obligation gets its own implementation plan and acceptance before the next begins.

## J0 Slice 1 exit gate

- relevant Vitest contracts pass;
- CSS ownership tests prove one canonical owner per changed selector family;
- real Electron proves Focus, Split, Grid, Arrange, Preview open/resize/close/offline, keyboard focus return, and the same connected xterm node;
- direct observation at 1440×900 and the native minimum 1120×720 shows no document or control overflow;
- at 1120×720 with Preview open, Projects is compact and the terminal remains usable;
- no unexpected console or main-process runtime errors;
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and desktop Electron smoke pass;
- final comparison is against the approved mockup and critique, not against a new visual alternative.

## Non-goals

- redesigning Sessions, Inbox, Context, or Privacy inside Slice 1;
- changing terminal or Preview state ownership;
- adding motion beyond existing restrained transitions;
- adding a theme selector or user-configurable material intensity;
- shipping a colorful application background;
- treating the mockup's demonstration background as production content;
- fixing unrelated findings or beginning Phase Z.

## Recovery

Slice 1 is a presentation-only, reversible change. If the real-Electron gate reveals a terminal lifecycle, focus, or geometry regression, do not add a workaround layer: revert the offending task and retain the current production shell while the failure is diagnosed.
