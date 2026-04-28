# Alfred Runner Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudowac pierwszy dzialajacy pion Alfreda: lokalny runner zbiera zdarzenia Codexa, bezpiecznie je redaguje, zapisuje do lokalnego outboxa SQLite i wysyla batchami do cloud API.

**Architecture:** Cloud API i Postgres sa canonical data layer. Lokalny runner jest cienkim mostem: adapter zrodel -> privacy redactor -> durable outbox -> ingest client -> `POST /v1/ingest/batches`. Codex jest pierwszym realnym zrodlem, a Claude/pozostali agenci dojda przez ten sam kontrakt.

**Tech Stack:** TypeScript, pnpm workspaces, Turbo, Vitest, Hono API, Drizzle/Postgres, SQLite outbox przez `better-sqlite3`, shared Zod contracts z `@alfred/schema`.

---

## 0. Aktualny Stan

Repo jest juz czystym rootem Alfreda, bez starego Tauri/Rust projektu.

Gotowe:

- `@alfred/schema` z kontraktami ingestu.
- `@alfred/db` z modelem Postgres.
- `@alfred/api` z `/health` i `POST /v1/ingest/batches`.
- Testy API i schema przechodza.
- Remote `origin/main` wskazuje na `https://github.com/pdudek2/Alfred.git`.

Stary prototyp jest poza repo:

```text
/Users/patryk/Desktop/Alfred_OLD
```

## 1. Zakres Tej Fazy

Ta faza buduje:

- pakiet `apps/runner`,
- konfiguracje runnera,
- lokalny SQLite outbox,
- klienta ingest API,
- flush worker z retry,
- privacy redactor przed zapisem,
- pakiet `packages/adapters`,
- pierwszy adapter Codexa,
- main loop runnera,
- smoke test: wygenerowany batch przechodzi `IngestBatchSchema`.

Ta faza nie buduje jeszcze:

- web UI,
- mobile shell,
- desktop shell,
- autoryzacji uzytkownikow,
- dashboard queries,
- MCP servera,
- BridgeMind-like warstwy rekomendacji.

## 2. Docelowa Struktura Plikow

```text
apps/
  runner/
    package.json
    tsconfig.json
    src/
      index.ts
      env.ts
      config.ts
      outbox/outbox-db.ts
      outbox/outbox-worker.ts
      sync/ingest-client.ts
      privacy/redactor.ts
      sources/source-adapter.ts
      sources/codex/codex-jsonl.ts
      sources/codex/codex-adapter.ts
      test/config.test.ts
      test/outbox.test.ts
      test/redactor.test.ts
      test/ingest-client.test.ts
      test/codex-adapter.test.ts
      test/runner-loop.test.ts
      test/fixtures/codex-session.jsonl
packages/
  adapters/
    package.json
    tsconfig.json
    src/index.ts
    src/normalize.ts
    test/normalize.test.ts
```

## 3. Runtime Konwencje

Env dla lokalnego runnera:

```bash
RUNNER_API_URL=http://127.0.0.1:4301
RUNNER_DEVICE_TOKEN=dev-device-token
RUNNER_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
RUNNER_DEVICE_ID=00000000-0000-4000-8000-000000000101
ALFRED_PRIVACY_MODE=standard
ALFRED_RUNNER_DB_PATH=.alfred-runner/outbox.sqlite
ALFRED_CODEX_HOME=/Users/patryk/.codex
ALFRED_ALLOW_DEV_CONFIG=1
```

Zasada:

- `NODE_ENV=test` moze miec dev defaulty.
- Runtime lokalny moze miec dev defaulty tylko przy `ALFRED_ALLOW_DEV_CONFIG=1`.
- Bez tokena/device/workspace runner ma failowac czytelnym bledem.

## 4. Kolejnosc Implementacji

### Task 1: Runner Package I Config

**Files:**

- Create: `apps/runner/package.json`
- Create: `apps/runner/tsconfig.json`
- Create: `apps/runner/src/env.ts`
- Create: `apps/runner/src/config.ts`
- Create: `apps/runner/src/index.ts`
- Test: `apps/runner/src/test/config.test.ts`

- [ ] **Step 1: Dodaj pakiet `@alfred/runner`**

`apps/runner/package.json`:

```json
{
  "name": "@alfred/runner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run src/test",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@alfred/schema": "workspace:*",
    "@alfred/adapters": "workspace:*",
    "better-sqlite3": "latest",
    "fast-glob": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/better-sqlite3": "latest",
    "@types/node": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Dodaj config TS**

`apps/runner/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Zaimplementuj env parser**

`apps/runner/src/env.ts` ma eksportowac:

```ts
export type RunnerEnv = {
  RUNNER_API_URL: string;
  RUNNER_DEVICE_TOKEN: string;
  RUNNER_WORKSPACE_ID: string;
  RUNNER_DEVICE_ID: string;
  ALFRED_PRIVACY_MODE: "minimal" | "standard" | "full";
  ALFRED_RUNNER_DB_PATH: string;
  ALFRED_CODEX_HOME: string;
};

export function parseRunnerEnv(input: NodeJS.ProcessEnv): RunnerEnv;
export const runnerEnv: RunnerEnv;
```

Wymagane zachowanie:

- `RUNNER_API_URL` domyslnie `http://127.0.0.1:4301` tylko w test/dev opt-in.
- `RUNNER_DEVICE_TOKEN`, `RUNNER_WORKSPACE_ID`, `RUNNER_DEVICE_ID` wymagane poza `NODE_ENV=test` i `ALFRED_ALLOW_DEV_CONFIG=1`.
- `ALFRED_PRIVACY_MODE` domyslnie `standard`.
- `ALFRED_RUNNER_DB_PATH` domyslnie `.alfred-runner/outbox.sqlite`.
- `ALFRED_CODEX_HOME` domyslnie `${HOME}/.codex`.
- bledny UUID ma dawac blad `Invalid RUNNER_WORKSPACE_ID` albo `Invalid RUNNER_DEVICE_ID`.

- [ ] **Step 4: Zaimplementuj config**

`apps/runner/src/config.ts`:

```ts
import { runnerEnv, type RunnerEnv } from "./env.js";

export type RunnerConfig = {
  apiUrl: string;
  deviceToken: string;
  workspaceId: string;
  deviceId: string;
  privacyMode: "minimal" | "standard" | "full";
  outboxPath: string;
  codexHome: string;
};

export function loadRunnerConfig(env: RunnerEnv = runnerEnv): RunnerConfig {
  return {
    apiUrl: env.RUNNER_API_URL.replace(/\/$/, ""),
    deviceToken: env.RUNNER_DEVICE_TOKEN,
    workspaceId: env.RUNNER_WORKSPACE_ID,
    deviceId: env.RUNNER_DEVICE_ID,
    privacyMode: env.ALFRED_PRIVACY_MODE,
    outboxPath: env.ALFRED_RUNNER_DB_PATH,
    codexHome: env.ALFRED_CODEX_HOME
  };
}
```

- [ ] **Step 5: Testy configu**

`apps/runner/src/test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadRunnerConfig } from "../config.js";
import { parseRunnerEnv } from "../env.js";

describe("runner env", () => {
  it("uses dev defaults in test mode", () => {
    const env = parseRunnerEnv({ NODE_ENV: "test", HOME: "/tmp/home" });
    expect(env.RUNNER_API_URL).toBe("http://127.0.0.1:4301");
    expect(env.RUNNER_DEVICE_TOKEN).toBe("dev-device-token");
    expect(env.ALFRED_CODEX_HOME).toBe("/tmp/home/.codex");
  });

  it("requires credentials outside dev opt-in", () => {
    expect(() => parseRunnerEnv({ NODE_ENV: "production", HOME: "/tmp/home" })).toThrow(
      /RUNNER_DEVICE_TOKEN/
    );
  });

  it("normalizes api url", () => {
    const config = loadRunnerConfig(
      parseRunnerEnv({
        ALFRED_ALLOW_DEV_CONFIG: "1",
        RUNNER_API_URL: "http://127.0.0.1:4301/",
        HOME: "/tmp/home"
      })
    );
    expect(config.apiUrl).toBe("http://127.0.0.1:4301");
  });
});
```

- [ ] **Step 6: Uruchom test**

Run:

```bash
pnpm --filter @alfred/runner test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/runner package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(runner): add local runner config"
```

### Task 2: Shared Adapter Normalization

**Files:**

- Create: `packages/adapters/package.json`
- Create: `packages/adapters/tsconfig.json`
- Create: `packages/adapters/src/index.ts`
- Create: `packages/adapters/src/normalize.ts`
- Test: `packages/adapters/test/normalize.test.ts`

- [ ] **Step 1: Dodaj pakiet `@alfred/adapters`**

`packages/adapters/package.json`:

```json
{
  "name": "@alfred/adapters",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run test",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@alfred/schema": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Dodaj normalizacje zdarzen**

`packages/adapters/src/normalize.ts`:

```ts
import { createHash } from "node:crypto";
import type { AgentSource, EventType, PrivacyMode, RunStatus } from "@alfred/schema";

export type NormalizedEventInput = {
  workspaceId: string;
  deviceId: string;
  projectKey: string;
  sourceId: AgentSource;
  sourceRunId: string;
  sourceEventId: string;
  parentSourceRunId?: string;
  type: EventType;
  status?: RunStatus;
  privacyMode: PrivacyMode;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function deterministicEventId(input: Pick<NormalizedEventInput, "workspaceId" | "sourceId" | "sourceRunId" | "sourceEventId" | "type">): string {
  return createHash("sha256")
    .update([input.workspaceId, input.sourceId, input.sourceRunId, input.sourceEventId, input.type].join("\n"))
    .digest("hex");
}

export function normalizeEvent(input: NormalizedEventInput) {
  return {
    event_id: deterministicEventId(input),
    workspace_id: input.workspaceId,
    device_id: input.deviceId,
    project_key: input.projectKey,
    source_id: input.sourceId,
    source_run_id: input.sourceRunId,
    source_event_id: input.sourceEventId,
    parent_source_run_id: input.parentSourceRunId,
    type: input.type,
    status: input.status,
    privacy_mode: input.privacyMode,
    occurred_at: input.occurredAt,
    payload: input.payload
  };
}
```

- [ ] **Step 3: Eksportuj API**

`packages/adapters/src/index.ts`:

```ts
export * from "./normalize.js";
```

- [ ] **Step 4: Test deterministycznego ID**

`packages/adapters/test/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deterministicEventId, normalizeEvent } from "../src/index.js";

describe("normalizeEvent", () => {
  it("creates stable event IDs", () => {
    const base = {
      workspaceId: "00000000-0000-4000-8000-000000000001",
      sourceId: "codex-cli" as const,
      sourceRunId: "run-1",
      sourceEventId: "event-1",
      type: "run.started" as const
    };

    expect(deterministicEventId(base)).toBe(deterministicEventId(base));
  });

  it("maps camelCase adapter fields to ingest contract", () => {
    const event = normalizeEvent({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      deviceId: "00000000-0000-4000-8000-000000000101",
      projectKey: "Alfred",
      sourceId: "codex-cli",
      sourceRunId: "run-1",
      sourceEventId: "event-1",
      type: "run.started",
      privacyMode: "standard",
      occurredAt: "2026-04-28T10:00:00.000Z",
      payload: { title: "Start" }
    });

    expect(event.workspace_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(event.source_id).toBe("codex-cli");
    expect(event.event_id).toHaveLength(64);
  });
});
```

- [ ] **Step 5: Uruchom test**

```bash
pnpm --filter @alfred/adapters test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/adapters pnpm-lock.yaml
git commit -m "feat(adapters): add event normalization"
```

### Task 3: SQLite Outbox I Privacy Redactor

**Files:**

- Create: `apps/runner/src/privacy/redactor.ts`
- Create: `apps/runner/src/outbox/outbox-db.ts`
- Test: `apps/runner/src/test/redactor.test.ts`
- Test: `apps/runner/src/test/outbox.test.ts`

- [ ] **Step 1: Privacy redactor**

`redactPayload(payload, mode)` musi:

- `minimal`: zostawic tylko klucze `summary`, `status`, `tool_name`, `exit_code`.
- `standard`: usunac sekrety po nazwach kluczy zawierajacych `token`, `secret`, `password`, `api_key`, `authorization`.
- `full`: zostawic payload bez zmian.
- rekurencyjnie redagowac obiekty i tablice.

Sekret zastapic stringiem:

```text
[redacted]
```

- [ ] **Step 2: Test redaktora**

Test ma pokryc:

- sekret na poziomie root,
- sekret w obiekcie zagniezdzonym,
- sekret w tablicy,
- tryb `minimal`,
- tryb `full`.

- [ ] **Step 3: SQLite outbox**

`outbox-db.ts` ma eksportowac:

```ts
export type OutboxRecord = {
  id: number;
  eventId: string;
  payload: unknown;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
};

export class OutboxDb {
  constructor(path: string);
  enqueue(event: { event_id: string; [key: string]: unknown }): void;
  listReady(limit: number, now?: Date): OutboxRecord[];
  markSent(ids: number[]): void;
  markFailed(id: number, nextAttemptAt: Date): void;
  close(): void;
}
```

Wymagania:

- katalog DB tworzy sie automatycznie,
- tabela `outbox_events`,
- unique `event_id`,
- duplicate enqueue nie tworzy drugiego rekordu,
- `listReady` sortuje po `created_at ASC`.

- [ ] **Step 4: Test outboxa**

Test ma uzywac pliku w `/tmp` albo `:memory:` i pokrywac:

- enqueue/list,
- idempotencje po `event_id`,
- markSent usuwa rekord,
- markFailed inkrementuje attempts i ustawia `next_attempt_at`.

- [ ] **Step 5: Uruchom testy**

```bash
pnpm --filter @alfred/runner test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/runner/src/privacy apps/runner/src/outbox apps/runner/src/test pnpm-lock.yaml
git commit -m "feat(runner): add privacy-safe sqlite outbox"
```

### Task 4: Ingest Client I Flush Worker

**Files:**

- Create: `apps/runner/src/sync/ingest-client.ts`
- Create: `apps/runner/src/outbox/outbox-worker.ts`
- Test: `apps/runner/src/test/ingest-client.test.ts`
- Test: `apps/runner/src/test/runner-loop.test.ts`

- [ ] **Step 1: Ingest client**

`ingest-client.ts` ma eksportowac:

```ts
import type { IngestBatch } from "@alfred/schema";

export type IngestClientConfig = {
  apiUrl: string;
  deviceToken: string;
  fetchImpl?: typeof fetch;
};

export async function postIngestBatch(config: IngestClientConfig, batch: IngestBatch): Promise<void>;
```

Wymagania:

- POST na `${apiUrl}/v1/ingest/batches`,
- header `Authorization: Bearer ${deviceToken}`,
- header `Content-Type: application/json`,
- status `202` oznacza sukces,
- inne statusy rzucaja `Error("Ingest failed with status <status>")`.

- [ ] **Step 2: Flush worker**

`flushOutboxOnce` ma:

- pobrac ready events z outboxa,
- zbudowac `IngestBatchSchema`,
- wyslac batch,
- po sukcesie `markSent`,
- po porazce `markFailed` z backoffem `min(60s, 2 ** attempts * 1000)`.

- [ ] **Step 3: Test klienta**

Test pokrywa:

- URL,
- auth header,
- body,
- blad na `500`.

- [ ] **Step 4: Test workera**

Test pokrywa:

- sukces usuwa rekordy,
- blad zostawia rekord i ustawia retry,
- pusty outbox nie wysyla requestu.

- [ ] **Step 5: Uruchom testy**

```bash
pnpm --filter @alfred/runner test
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/runner/src/sync apps/runner/src/outbox apps/runner/src/test
git commit -m "feat(runner): sync outbox to ingest api"
```

### Task 5: Codex Adapter

**Files:**

- Create: `apps/runner/src/sources/source-adapter.ts`
- Create: `apps/runner/src/sources/codex/codex-jsonl.ts`
- Create: `apps/runner/src/sources/codex/codex-adapter.ts`
- Create: `apps/runner/src/test/fixtures/codex-session.jsonl`
- Test: `apps/runner/src/test/codex-adapter.test.ts`

- [ ] **Step 1: Source adapter interface**

```ts
import type { IngestEvent } from "@alfred/schema";

export type SourceAdapter = {
  sourceId: string;
  collect(): Promise<IngestEvent[]>;
};
```

- [ ] **Step 2: JSONL reader**

`codex-jsonl.ts` ma:

- czytac pliki `.jsonl`,
- ignorowac puste linie,
- ignorowac niepoprawny JSON bez crasha,
- zwracac tablice `unknown`.

- [ ] **Step 3: Codex adapter**

Pierwsza wersja ma byc defensywna:

- skanuje `ALFRED_CODEX_HOME` pod `sessions/**/*.jsonl`,
- mapuje znane minimalne rekordy do `run.started`, `tool.started`, `tool.completed`, `run.completed`,
- nie zaklada pelnej stabilnosci formatu Codexa,
- jesli nie rozpoznaje rekordu, pomija go,
- `project_key` wyciaga z `cwd` albo domyslnie `unknown-project`,
- eventy przechodza przez `normalizeEvent`.

- [ ] **Step 4: Fixture**

Fixture ma zawierac minimum:

```jsonl
{"timestamp":"2026-04-28T10:00:00.000Z","type":"session.start","id":"codex-run-1","cwd":"/Users/patryk/Desktop/Alfred"}
{"timestamp":"2026-04-28T10:00:01.000Z","type":"tool.call","id":"tool-1","session_id":"codex-run-1","tool":"exec_command"}
{"timestamp":"2026-04-28T10:00:02.000Z","type":"tool.result","id":"tool-1-result","session_id":"codex-run-1","tool":"exec_command","status":"completed"}
{"timestamp":"2026-04-28T10:00:03.000Z","type":"session.end","id":"codex-run-1","status":"completed"}
```

- [ ] **Step 5: Test adaptera**

Test ma potwierdzic:

- generuje 4 eventy,
- `source_id` to `codex-cli`,
- wszystkie eventy maja `workspace_id` i `device_id`,
- wynik przechodzi `IngestEventSchema.array()`.

- [ ] **Step 6: Uruchom testy**

```bash
pnpm --filter @alfred/runner test
pnpm --filter @alfred/adapters test
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/runner/src/sources apps/runner/src/test
git commit -m "feat(runner): collect codex session events"
```

### Task 6: Runner Main Loop I Smoke

**Files:**

- Modify: `apps/runner/src/index.ts`
- Test: `apps/runner/src/test/runner-loop.test.ts`
- Modify: `README.md`
- Modify: `docs/REFOUNDATION_STATUS.md`

- [ ] **Step 1: Main loop**

`index.ts` ma:

- wczytac config,
- utworzyc outbox,
- uruchomic Codex adapter,
- zredagowac payload kazdego eventu,
- zapisac eventy do outboxa,
- wykonac `flushOutboxOnce`,
- zamknac outbox na `SIGINT` i `SIGTERM`.

Pierwszy runtime moze byc jednorazowy:

```bash
pnpm --filter @alfred/runner dev
```

Ciagla petla pollingowa zostanie dodana po potwierdzeniu formatu Codexa na realnych danych.

- [ ] **Step 2: Smoke validation**

Dodaj test, ktory:

- uzywa fixture Codexa,
- buduje batch,
- waliduje `IngestBatchSchema.safeParse(batch).success === true`.

- [ ] **Step 3: Docs**

README ma dostac sekcje:

```bash
ALFRED_ALLOW_DEV_CONFIG=1 pnpm --filter @alfred/runner dev
```

`docs/REFOUNDATION_STATUS.md` ma zostac zaktualizowany:

- czysty root repo,
- runner pipeline started/completed zgodnie ze stanem,
- kolejny krok: dashboard query API.

- [ ] **Step 4: Pelna walidacja**

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/runner README.md docs/REFOUNDATION_STATUS.md pnpm-lock.yaml
git commit -m "feat(runner): wire codex events into ingest outbox"
```

## 5. Definition Of Done

Faza jest gotowa, gdy:

- `pnpm test` przechodzi,
- `pnpm typecheck` przechodzi,
- `pnpm build` przechodzi,
- runner potrafi z fixture Codexa wygenerowac poprawny `IngestBatch`,
- outbox jest idempotentny,
- payload jest redagowany przed zapisem,
- ingest client wysyla batch do istniejacego API kontraktu.

## 6. Kolejna Faza Po Tym Planie

Po runnerze robimy:

1. Query API dla obserwatorium:
   - lista runs,
   - run detail,
   - timeline events,
   - latest agent activity.
2. Web app:
   - live command center,
   - agent timeline,
   - project/runs view.
3. Desktop/mobile:
   - najpierw PWA,
   - potem Tauri/Capacitor tylko jako shell, jesli bedzie realna potrzeba.
4. Alfred z dusza:
   - field reports,
   - decision memory,
   - nudges,
   - "co powinienem teraz wiedziec?".

## 7. Execution Choice

Plan gotowy. Rekomendowana egzekucja:

```text
Inline Execution dla Task 1-2, potem commit.
Inline Execution dla Task 3-4, potem commit.
Inline Execution dla Task 5-6, potem commit.
```

Powod: to jeszcze maly kodbase, a runner dotyka wspolnych kontraktow. Szybciej bedzie implementowac w tej sesji i robic czeste testy niz rozbijac to na wielu workerow.
