# Alfred Agent Operating Rules

## Language

Use Polish for user-facing summaries unless the task explicitly requires English.

## Git

- Never add AI co-author trailers.
- Never push unless Patryk explicitly asks.
- Never force push.
- Work in your assigned branch only.
- Keep commits small and focused.
- Before finishing, run the narrow relevant checks. Run full `pnpm test`, `pnpm typecheck`, and `pnpm build` if your change touches shared behavior.

## Parallel Work

- This repository may have many simultaneous Codex and Claude sessions.
- Use only your assigned worktree and branch.
- Do not edit files outside your assigned ownership unless your prompt explicitly allows it.
- Do not revert or overwrite other agents' work.
- Do not modify `.worktrees/` outside your own directory.

## High-Risk Shared Files

Coordinate before changing these:

- `pnpm-lock.yaml`
- `packages/db/src/schema.ts`
- `drizzle/**`
- `README.md`
- `AGENTS.md`
- broad global styles in `apps/web/src/styles.css`

## Services

- Main local web app: `http://127.0.0.1:4300`
- Main local API: `http://127.0.0.1:4301`
- Agent worktrees should use their assigned ports when running services.

## Runner

Do not run the real runner against `~/.codex` unless the assigned task is runner ingestion work.
Use fixtures or temporary `ALFRED_CODEX_HOME` paths for tests.
