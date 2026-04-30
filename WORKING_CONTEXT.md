---
schema_version: 1
save_sequence: 7
last_loaded_at: null
last_saved_at: 2026-04-30T06:11:39.748Z
last_saved_by: claude-code
git_head: 4903ba5
session_label: null
---

# Working Context

## Sprint

- Status: review
- Focus: Iron audit of Alfred security, reliability, product shape, and visual soul pass follow-ups

## Decisions Locked

- Treat Alfred's current product shape as a personal agent observability inbox before calling it a command center.
- Prioritize trust foundations: API auth/workspace scoping, ingest identity binding, runner freshness, and data privacy before adding missions/knowledge/alerts.


## Shipped This Save

- Completed iron audit across web, API, runner, security, QA, and product with subagents.
- Verified local app/API state with browser screenshots for Reader, Observatory, and RunReader drawer.
- Confirmed full local validation passes: pnpm test, pnpm typecheck, and pnpm build.
- Confirmed runtime API contract issues: invalid runId returns 500 and invalid limit values return 200.
- Translated audit findings into simpler user-facing language.


## What's Next

- [ ] Add auth and workspace scoping to GET /v1/runs and GET /v1/runs/:runId.  → cite: apps/api/src/routes/runs.ts
- [ ] Bind ingest tokens to a concrete device/workspace and validate batch event workspace/device consistency.  → cite: apps/api/src/routes/ingest.ts
- [ ] Fix run status upserts so technical events without status do not degrade completed/running runs to unknown.  → cite: apps/api/src/services/ingest-service.ts
- [ ] Add Postgres-backed API integration tests for ingest upserts, duplicates, parent relations, filters, and invalid IDs.  → cite: apps/api/src/test
- [ ] Make RunReader a real modal with focus trap, inert background, scroll lock, and restore focus.  → cite: apps/web/src/components/run-reader.tsx
- [ ] Make Observatory accessible and easier to hit by removing aria-hidden from interactive nodes and adding larger hit targets plus an inspector.  → cite: apps/web/src/components/observatory.tsx
- [ ] Show runner freshness/last sync/offline state so live UI is trustworthy.  → cite: apps/runner


## Recent Commits (auto, last 5)

- 4903ba5 Web triage reader (#3)
- e440c9d feat(web): add observatory view (#2)
- 77bad13 feat(api): add runs query endpoints
- a3b71ce fix(api): align dev runner token config
- 9b2ff4e first commit


## Open Questions

- None


## Running State

Passing:
- pnpm test
- pnpm typecheck
- pnpm build
- Local API health endpoint returned ok
- Playwright CLI captured Reader, Observatory, and RunReader screenshots

Broken:
- GET /v1/runs/not-a-uuid returns 500 instead of 400
- GET /v1/runs?limit=abc and limit=0 return 200 instead of invalid_limit

Untested:
- No code fixes from the audit have been implemented yet
- No real Postgres integration suite or CI workflow exists yet
- Browser Use plugin workflow was not available because node_repl/js was not exposed


## Verification Notes

- None
