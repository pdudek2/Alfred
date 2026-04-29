---
schema_version: 1
save_sequence: 5
last_loaded_at: null
last_saved_at: 2026-04-29T20:10:03Z
last_saved_by: codex
git_head: 2954df4
session_label: null
---

# Working Context

## Sprint

- Status: shipped
- Focus: Reader redesign + first Observatory mode landed; new AppShell is default

## Decisions Locked

- Reader + Observatory share single AppShell, swapped via cmd+O window-open transition; not nav tabs
- Drawer focus master/detail (Layout 3): clicking a run blurs and dims the feed and opens RunReader; Esc closes
- Visual mood = warm dark hybrid (A+D) with light constellation touch in Observatory; no glow except live/needs-you halos
- Product UI strings in English; agent-facing summaries in Polish per AGENTS.md
- Voice register = 95% quiet briefing (C) with 5% first-person Alfred (B) reserved for briefing, failure, empty, and API-error lines
- New Reader/AppShell is default; `?legacy=1` and `?mockup=1` routes are retired


## Shipped This Save

- Reader redesign + first Observatory mode landed: warm dark shell, butler voice, drawer focus, cmd+O mode switch
- View-model extended with time-grouped feed, run intent, briefing synthesis, run-story synthesis, and deterministic Observatory layout
- First Observatory canvas renders project clusters, node status halos, edges, and time-scope controls
- Source Serif 4 is self-hosted from official Adobe WOFF2 release with `font-display: swap`
- Legacy console components removed; `?mockup=1` and `?legacy=1` routes retired


## What's Next

- [ ] Wire real `parent_run_id` in the runner so Observatory edges populate from actual agent relationships.  → cite: apps/runner
- [ ] Add cloud-worker run-story enrichment (LLM-assisted) for richer summaries.  → cite: apps/api
- [ ] Mobile-first pass on Reader/Observatory.  → cite: apps/web/src/components
- [ ] Track `AGENTS.md` clarification: product copy is English; agent summaries stay Polish.  → cite: AGENTS.md
- [ ] Visual pass with real live data: check if Observatory/Reader now feels like Alfred rather than a diagnostic console.  → cite: apps/web/src/components


## Recent Commits (auto, last 5)

- 2954df4 chore(web): remove legacy reader components and mockup route
- 3ad7e43 feat(web): promote new reader shell to default
- 7fe8ff6 chore(web): self-host Source Serif 4 with font-display swap
- 694cec1 test(web): cover API error voice in Reader
- 7914f07 feat(web): add AppShell with mode switch


## Open Questions

- None


## Running State

Passing:
- pnpm --filter @alfred/web test
- pnpm --filter @alfred/web typecheck
- pnpm --filter @alfred/web build
- pnpm test
- pnpm typecheck
- pnpm build

Broken:
- None

Untested:
- Manual browser visual pass after final cleanup


## Verification Notes

- Root validation passed after legacy cleanup: `pnpm test`, `pnpm typecheck`, `pnpm build`
- `?legacy=1` and `?mockup=1` intentionally fall through to the new shell
