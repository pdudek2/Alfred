# Alfred Refoundation Status

Data: 2026-04-28
Branch: `runner-pipeline`
Stan: MVP0 cloud/API foundation gotowe, runner pipeline dla Codexa zaimplementowany

## Gdzie jestesmy

Przeszlismy z pomyslu "macOS native Tauri/Rust app" na kierunek:

- personal cloud first,
- SaaS-ready data model,
- web/mobile/desktop przez web-first architekture,
- local runner jako most do Claude/Codex,
- Postgres jako canonical cloud DB,
- lokalny SQLite tylko jako outbox runnera.

Repo `/Users/patryk/Desktop/Alfred` jest juz czystym rootem refoundation. Stary prototyp jest zachowany poza repo jako `/Users/patryk/Desktop/Alfred_OLD`.

## Zrobione

### Dokumenty

- `docs/ALFRED_REFOUNDATION.md` - manifest kierunku produktowo-technicznego.
- `docs/superpowers/plans/2026-04-27-alfred-refoundation-mvp0.md` - pelny plan MVP0.
- `docs/superpowers/plans/2026-04-28-alfred-runner-pipeline.md` - dalszy plan runner pipeline.

### Kod

Zaimplementowany pierwszy pakiet Tasks 1-5 z planu MVP0:

1. `refoundation/` workspace:
   - pnpm,
   - Turbo,
   - TypeScript base config,
   - lokalne env example.

2. `@alfred/schema`:
   - `AgentSource`, `PrivacyMode`, `RunStatus`, `EventType`,
   - `IngestBatchSchema`,
   - `IngestEventSchema`,
   - `FieldReportSchema`,
   - `PrivacyPolicySchema`,
   - rozdzielone typy input/output dla schem z defaultami.

3. `@alfred/db`:
   - Drizzle/Postgres schema,
   - tabele dla workspace, devices, projects, runs, events, field reports, alerts, source cursors, ingest batches,
   - migracje `0000` i `0001`,
   - `event_id` persistowane w `events`,
   - bezpieczna migracja `event_id` z backfillem `legacy:<uuid>`.

4. `@alfred/api` skeleton:
   - Hono app,
   - `/health`,
   - bearer device auth,
   - testy kontraktu response i happy path auth.

5. Ingest API:
   - `POST /v1/ingest/batches`,
   - walidacja `IngestBatchSchema`,
   - `400 { error: "invalid_body" }` dla zlego body,
   - `202` dla przyjetych batchy,
   - idempotent batch ingest,
   - duplicate event counting,
   - run timestamp handling dla `run.started` / `run.completed` / `run.failed`,
   - ograniczony dev token fallback tylko dla testow albo jawnego opt-in.

### Runner pipeline

Zaimplementowane na branchu `runner-pipeline`:

- `@alfred/runner` package + config,
- `@alfred/adapters` z deterministyczna normalizacja eventow,
- privacy redactor,
- SQLite outbox,
- ingest client,
- flush worker,
- defensywny Codex JSONL adapter,
- jednorazowy runner loop: collect -> redact -> enqueue -> flush.
- realny smoke na `~/.codex` bez drukowania payloadow: 117 plikow JSONL, 32618 eventow rozpoznanych.

## Aktualne commity

Najnowsze commity:

```text
0916609 feat(runner): add privacy-safe outbox sync
3d108de feat(runner): add runner foundation
3d6e598 first commit
```

Wazne commity z poprzedniego prototypowego etapu w `Alfred_OLD`:

```text
8177e4e chore(api): harden ingest edge cases
f5ad220 feat(api): ingest runner event batches
8eb7009 feat(api): add cloud API skeleton
e5b2e63 feat(db): add Alfred cloud schema
41da362 feat(schema): add Alfred event contracts
a2c5d6c chore: scaffold Alfred refoundation workspace
```

## Walidacja

Ostatnia pelna walidacja w root repo:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Wynik:

- `pnpm test` - PASS.
- `pnpm typecheck` - PASS.
- `pnpm build` - PASS.

## Znane ryzyko

Nie potwierdzilismy jeszcze migracji/ingestu na zywym Postgresie, bo Docker daemon lokalnie nie dzialal:

```text
failed to connect to docker API socket
```

To nie blokuje planowania kolejnej fazy, ale przed uznaniem cloud ingest za runtime-ready trzeba wykonac:

```bash
cd refoundation
docker compose up -d postgres
pnpm exec drizzle-kit migrate --config apps/api/drizzle.config.ts
```

Potem warto uruchomic live ingest smoke na prawdziwym Postgresie.

## Nastepny krok

Dokonczyc `Runner Pipeline`:

1. Uruchomic API + Postgres.
2. Wyslac live batch runnera do `/v1/ingest/batches`.
3. Dodac Claude hook adapter jako drugie zrodlo.
4. Zaczac query API dla obserwatorium:
   - lista runs,
   - run detail,
   - timeline events,
   - latest agent activity.

Rekomendowana egzekucja:

```text
inline, bo kodbase jest nadal maly
```
