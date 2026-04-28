# Alfred Refoundation Status

Data: 2026-04-28
Branch: `refoundation-mvp0`
Stan: MVP0 cloud/API foundation gotowe, runner pipeline zaplanowany

## Gdzie jestesmy

Przeszlismy z pomyslu "macOS native Tauri/Rust app" na kierunek:

- personal cloud first,
- SaaS-ready data model,
- web/mobile/desktop przez web-first architekture,
- local runner jako most do Claude/Codex,
- Postgres jako canonical cloud DB,
- lokalny SQLite tylko jako outbox runnera.

Obecny Alfred Lab w `app/` i `hooks/` zostaje prototypem/laboratorium domenowym. Nowy produkt powstaje w `refoundation/`.

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

## Aktualne commity refoundation

Ostatni commit kodowy:

```text
8177e4e chore(api): harden ingest edge cases
```

Najwazniejsze commity tej fazy:

```text
8177e4e chore(api): harden ingest edge cases
f5ad220 feat(api): ingest runner event batches
8eb7009 feat(api): add cloud API skeleton
e5b2e63 feat(db): add Alfred cloud schema
41da362 feat(schema): add Alfred event contracts
a2c5d6c chore: scaffold Alfred refoundation workspace
```

## Walidacja

Ostatnia pelna walidacja w `refoundation/`:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Wynik:

- `pnpm test` - PASS
  - schema: 7 tests,
  - api: 9 tests.
- `pnpm typecheck` - PASS
  - 3 packages.
- `pnpm build` - PASS
  - 3 packages.

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

## Aktualny brudny worktree

Na branchu sa nadal niescommitowane zmiany poza refoundation:

```text
app/src-tauri/src/anomaly.rs
app/src-tauri/src/commands.rs
app/src-tauri/src/db.rs
app/src-tauri/src/notif_callback.rs
app/src-tauri/src/store.rs
app/src/lib/stores/sessions.ts
app/src/main/MemoryTab.svelte
hooks/_common.py
hooks/__pycache__/
```

Nie dotykalismy ich w refoundation. Traktowac jako osobny kontekst/starszy stan.

## Nastepny krok

Nastepna faza to `Runner Pipeline`:

1. `@alfred/runner` package + env/config.
2. SQLite outbox.
3. Ingest client + flush worker.
4. Privacy redactor przed zapisem do outboxa.
5. `@alfred/adapters` z deterministycznym event ID.
6. Codex CLI adapter.
7. Claude hook adapter.
8. Runner main loop.
9. Runner smoke validation.

Rekomendowana egzekucja:

```text
subagent-driven, Task 1-4 najpierw
```

Powod: zanim wpuscimy Codex/Claude, musimy miec outbox, sync i redakcje danych.
