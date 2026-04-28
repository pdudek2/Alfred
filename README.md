# Alfred Refoundation

This repository is the new personal-cloud Alfred refoundation. The old Tauri/Rust prototype lives outside this repo as `Alfred_OLD`.

Alfred is being rebuilt as a web-first agent observatory and command center:

- cloud API + Postgres as the canonical data layer,
- local runner for Claude Code and Codex,
- SQLite only as the runner's durable outbox,
- shared TypeScript contracts for API, runner, and future web/mobile clients.

## Local commands

Run commands from this directory:

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm typecheck
```

Copy `.env.example` to `.env` for local configuration when services are added.

## Current phase

MVP0 cloud/API foundation is in place. The current implementation phase is the local runner pipeline:

1. runner package and config,
2. SQLite outbox,
3. ingest client and flush worker,
4. privacy redactor,
5. Codex source adapter.

See `docs/REFOUNDATION_STATUS.md` and `docs/superpowers/plans/2026-04-28-alfred-runner-pipeline-clean-root.md`.

## Runner

For local development:

```bash
ALFRED_ALLOW_DEV_CONFIG=1 pnpm --filter @alfred/runner dev
```

The runner currently performs one pass: collect Codex session events, redact payloads, enqueue them into SQLite, and flush the outbox to `POST /v1/ingest/batches`. Claude hooks are planned as the next source adapter, after live Codex ingest is confirmed end to end.
