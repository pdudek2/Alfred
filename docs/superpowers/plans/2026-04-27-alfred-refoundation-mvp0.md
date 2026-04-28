# Alfred Refoundation MVP0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first personal-cloud Alfred that observes Claude Code and Codex in one timeline, syncs through a local runner, exposes MCP mission/report tools, and works as a responsive web/PWA app on desktop, web, and mobile.

**Architecture:** Start a new isolated TypeScript monorepo under `refoundation/` so the existing Tauri prototype remains untouched. Use a cloud API with Postgres for canonical data, a local runner for agent-source collection and privacy enforcement, shared schema packages for event contracts, and a web app for Live/Runs/Missions/Reports. Claude Code and Codex are first-class source adapters in MVP0.

**Tech Stack:** pnpm workspaces, Turborepo, TypeScript strict mode, Hono API, Drizzle ORM, Postgres, Zod, Next.js App Router web app, TanStack Query, local Node.js runner, better-sqlite3 for local Codex reads, official MCP TypeScript SDK, Vitest, Playwright.

---

## 0. Decision Summary

This plan implements `docs/ALFRED_REFOUNDATION.md` without modifying the current `app/` Tauri code or existing `hooks/` behavior.

Recommended shape:

- `refoundation/apps/api` - cloud ingest/API service.
- `refoundation/apps/web` - responsive web/PWA client.
- `refoundation/apps/runner` - local collector, source adapters, outbox, MCP server.
- `refoundation/packages/schema` - shared Zod contracts and TypeScript types.
- `refoundation/packages/db` - Drizzle schema and migrations.
- `refoundation/packages/adapters` - Claude and Codex normalization logic shared by runner tests.
- `refoundation/packages/mcp` - MCP tool schemas and server helpers.
- `refoundation/packages/ui` - shared UI primitives once the web app starts repeating patterns.

MVP0 is not a hosted agent executor. It observes, normalizes, syncs, displays, and lets agents interact with missions/reports through MCP.

## 1. Product Scope

MVP0 must ship these capabilities:

- Personal workspace bootstrapped locally.
- Device registration with a runner token.
- Ingest batches from local runner to cloud API.
- Offline outbox in runner.
- Claude Code adapter from hook-generated events.
- Codex CLI adapter from `~/.codex/state_5.sqlite`, `~/.codex/logs_2.sqlite`, and `~/.codex/sessions/**/*.jsonl`.
- Unified run model for Claude and Codex.
- Live view across all sources.
- Run detail with event timeline, metadata, artifacts, and field report.
- Missions board for manual tasks.
- MCP tools for missions, findings, field reports, and project memory.
- Privacy modes: `minimal`, `standard`, `full`, with `standard` default.
- No raw transcript sync unless project/run is set to `full`.

MVP0 explicitly excludes:

- Team billing.
- Hosted execution.
- Native mobile app store release.
- Desktop tray companion.
- Full eval/replay engine.
- Automatic write access to local repos from cloud.

## 2. External References Used

- Turborepo workspaces recommend `apps/*` and `packages/*`: https://turborepo.com/docs/guides/workspaces
- Hono Node adapter runs on Node and gives a small API surface: https://hono.dev/docs/getting-started/nodejs
- Drizzle supports PostgreSQL schema and migrations in TypeScript: https://orm.drizzle.team/docs/get-started/postgresql-new.html
- Next.js App Router route handlers and app structure are the current web baseline: https://nextjs.org/docs/app/api-reference/file-conventions/route
- TanStack Query manages server state in React apps: https://tanstack.com/query/latest/docs
- MCP has official TypeScript SDK support: https://modelcontextprotocol.io/docs/sdk
- Capacitor remains the recommended path if the PWA needs native mobile APIs after MVP0: https://capacitorjs.com/docs
- Expo supports monorepos, but we avoid native React Native in MVP0 to reduce scope: https://docs.expo.dev/guides/monorepos/

## 3. File Structure

Create this tree:

```text
refoundation/
  README.md
  package.json
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  .env.example
  docker-compose.yml
  apps/
    api/
      package.json
      tsconfig.json
      drizzle.config.ts
      src/
        index.ts
        env.ts
        app.ts
        auth/device-auth.ts
        routes/health.ts
        routes/ingest.ts
        routes/runs.ts
        routes/missions.ts
        routes/reports.ts
        services/ingest-service.ts
        services/query-service.ts
        test/app.test.ts
    web/
      package.json
      tsconfig.json
      next.config.ts
      src/
        app/layout.tsx
        app/page.tsx
        app/runs/[runId]/page.tsx
        app/missions/page.tsx
        app/reports/page.tsx
        app/settings/page.tsx
        app/globals.css
        components/app-shell.tsx
        components/live-run-list.tsx
        components/run-timeline.tsx
        components/mission-board.tsx
        lib/api-client.ts
        lib/query-client.tsx
        test/live-run-list.test.tsx
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
        sources/source-adapter.ts
        sources/claude/claude-adapter.ts
        sources/claude/hook-server.ts
        sources/claude/hooks/alfred_claude_hook.py
        sources/codex/codex-adapter.ts
        sources/codex/codex-sqlite.ts
        sources/codex/codex-jsonl.ts
        privacy/redactor.ts
        mcp/server.ts
        test/fixtures/codex-state.sql
        test/fixtures/codex-session.jsonl
        test/codex-adapter.test.ts
        test/redactor.test.ts
  packages/
    schema/
      package.json
      tsconfig.json
      src/index.ts
      src/enums.ts
      src/ingest.ts
      src/runs.ts
      src/missions.ts
      src/reports.ts
      src/privacy.ts
      test/schema.test.ts
    db/
      package.json
      tsconfig.json
      src/index.ts
      src/schema.ts
      src/client.ts
      src/migrations.ts
    adapters/
      package.json
      tsconfig.json
      src/index.ts
      src/normalize.ts
      test/normalize.test.ts
    mcp/
      package.json
      tsconfig.json
      src/index.ts
      src/tools.ts
      test/tools.test.ts
```

Do not create `apps/mobile` or desktop shell in MVP0. The web app must be responsive and installable as PWA. Mobile/native wrappers come after the core feedback loop works.

## 4. Cross-Cutting Rules

- Use `pnpm` from `refoundation/`.
- Use TypeScript `strict: true`.
- Every app/package has `test`, `typecheck`, and `lint` scripts.
- Every API mutation has an idempotency path or unique constraint.
- Every event payload crosses package boundaries through `packages/schema`.
- Runner never uploads full transcript data unless `privacy_mode === "full"`.
- Runner must degrade source-by-source. Codex adapter failure cannot stop Claude sync.
- Each task should be committed separately.
- Do not add AI co-author trailers to commits.

## 5. Package Baselines

Use these package names and dependency sets when creating app packages.

API package:

```json
{
  "name": "@alfred/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@alfred/db": "workspace:*",
    "@alfred/schema": "workspace:*",
    "@hono/node-server": "latest",
    "drizzle-orm": "latest",
    "hono": "latest",
    "pg": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/pg": "latest",
    "drizzle-kit": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

Runner package:

```json
{
  "name": "@alfred/runner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@alfred/adapters": "workspace:*",
    "@alfred/mcp": "workspace:*",
    "@alfred/schema": "workspace:*",
    "@hono/node-server": "latest",
    "@modelcontextprotocol/server": "latest",
    "better-sqlite3": "latest",
    "fast-glob": "latest",
    "hono": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@types/better-sqlite3": "latest",
    "tsx": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

Web package:

```json
{
  "name": "@alfred/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "dev": "next dev --port 4300",
    "lint": "next lint",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@alfred/schema": "workspace:*",
    "@tanstack/react-query": "latest",
    "lucide-react": "latest",
    "next": "latest",
    "react": "latest",
    "react-dom": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@testing-library/react": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

All package `tsconfig.json` files extend `../../tsconfig.base.json` for apps or `../../tsconfig.base.json` for packages from their own directory depth. Set `outDir` to `dist` for non-Next packages.

## 6. Data Contracts

Core enums:

```ts
export const AgentSource = z.enum([
  "claude-code",
  "codex-cli",
  "openai-agents-sdk",
  "langgraph",
  "custom",
]);

export const PrivacyMode = z.enum(["minimal", "standard", "full"]);

export const RunStatus = z.enum([
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);

export const EventType = z.enum([
  "run.started",
  "run.updated",
  "run.completed",
  "run.failed",
  "agent.waiting",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "file.touched",
  "command.executed",
  "test.result",
  "spawn.created",
  "field_report.submitted",
  "alert.raised",
]);
```

Ingest batch contract:

```ts
export const IngestEventSchema = z.object({
  event_id: z.string().min(12),
  workspace_id: z.string().uuid(),
  device_id: z.string().uuid(),
  project_key: z.string().min(1),
  source_id: AgentSource,
  source_run_id: z.string().min(1),
  source_event_id: z.string().min(1),
  parent_source_run_id: z.string().optional(),
  type: EventType,
  status: RunStatus.optional(),
  privacy_mode: PrivacyMode.default("standard"),
  occurred_at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const IngestBatchSchema = z.object({
  batch_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  device_id: z.string().uuid(),
  sent_at: z.string().datetime(),
  events: z.array(IngestEventSchema).min(1).max(500),
});
```

Field report contract:

```ts
export const FieldReportSchema = z.object({
  mission_id: z.string().uuid().optional(),
  run_id: z.string().uuid().optional(),
  source_id: AgentSource,
  summary: z.string().min(1).max(4000),
  completed_work: z.array(z.string().min(1)).default([]),
  files_touched: z.array(z.string()).default([]),
  commands_run: z.array(z.string()).default([]),
  tests_run: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  needs_human_review: z.boolean().default(false),
});
```

## 7. Implementation Tasks

### Task 1: Create Refoundation Workspace

**Files:**

- Create: `refoundation/package.json`
- Create: `refoundation/pnpm-workspace.yaml`
- Create: `refoundation/turbo.json`
- Create: `refoundation/tsconfig.base.json`
- Create: `refoundation/.env.example`
- Create: `refoundation/README.md`

- [ ] **Step 1: Create workspace metadata**

Use this exact root `package.json`:

```json
{
  "name": "alfred-refoundation",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "latest",
    "typescript": "latest",
    "vitest": "latest",
    "tsx": "latest"
  }
}
```

Use this `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Use this `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 2: Add shared TypeScript config**

Use this `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

- [ ] **Step 3: Add environment example**

Use this `.env.example`:

```bash
DATABASE_URL=postgres://alfred:alfred@127.0.0.1:54329/alfred
API_PORT=4301
WEB_PORT=4300
RUNNER_API_URL=http://127.0.0.1:4301
RUNNER_DEVICE_TOKEN=dev-device-token
RUNNER_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
RUNNER_DEVICE_ID=00000000-0000-4000-8000-000000000101
ALFRED_PRIVACY_MODE=standard
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
cd refoundation
pnpm install
```

Expected: lockfile created and no dependency errors.

- [ ] **Step 5: Verify empty workspace scripts**

Run:

```bash
cd refoundation
pnpm typecheck
pnpm test
```

Expected: Turbo reports no packages yet or succeeds without app tasks.

- [ ] **Step 6: Commit**

```bash
git add refoundation/package.json refoundation/pnpm-workspace.yaml refoundation/turbo.json refoundation/tsconfig.base.json refoundation/.env.example refoundation/README.md refoundation/pnpm-lock.yaml
git commit -m "chore: scaffold Alfred refoundation workspace"
```

### Task 2: Add Shared Schema Package

**Files:**

- Create: `refoundation/packages/schema/package.json`
- Create: `refoundation/packages/schema/tsconfig.json`
- Create: `refoundation/packages/schema/src/enums.ts`
- Create: `refoundation/packages/schema/src/ingest.ts`
- Create: `refoundation/packages/schema/src/runs.ts`
- Create: `refoundation/packages/schema/src/missions.ts`
- Create: `refoundation/packages/schema/src/reports.ts`
- Create: `refoundation/packages/schema/src/privacy.ts`
- Create: `refoundation/packages/schema/src/index.ts`
- Create: `refoundation/packages/schema/test/schema.test.ts`

- [ ] **Step 1: Create package metadata**

Use:

```json
{
  "name": "@alfred/schema",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

- [ ] **Step 2: Add schema code**

Implement the enums and schemas from section 5. Export inferred types:

```ts
export type AgentSource = z.infer<typeof AgentSource>;
export type PrivacyMode = z.infer<typeof PrivacyMode>;
export type RunStatus = z.infer<typeof RunStatus>;
export type EventType = z.infer<typeof EventType>;
export type IngestEvent = z.infer<typeof IngestEventSchema>;
export type IngestBatch = z.infer<typeof IngestBatchSchema>;
export type FieldReport = z.infer<typeof FieldReportSchema>;
```

- [ ] **Step 3: Add privacy policy schema**

Create:

```ts
export const PrivacyPolicySchema = z.object({
  mode: PrivacyMode.default("standard"),
  allow_full_transcript: z.boolean().default(false),
  allowed_artifact_globs: z.array(z.string()).default([]),
  denied_artifact_globs: z.array(z.string()).default([".env", ".env.*", "**/*secret*", "**/*token*"]),
});

export type PrivacyPolicy = z.infer<typeof PrivacyPolicySchema>;
```

- [ ] **Step 4: Add schema tests**

Test these exact cases:

```ts
import { describe, expect, it } from "vitest";
import { IngestBatchSchema, FieldReportSchema, PrivacyPolicySchema } from "../src/index";

describe("schema contracts", () => {
  it("accepts a minimal standard ingest batch", () => {
    const parsed = IngestBatchSchema.parse({
      batch_id: "00000000-0000-4000-8000-000000000201",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      device_id: "00000000-0000-4000-8000-000000000101",
      sent_at: "2026-04-27T20:00:00.000Z",
      events: [{
        event_id: "evt_000000000001",
        workspace_id: "00000000-0000-4000-8000-000000000001",
        device_id: "00000000-0000-4000-8000-000000000101",
        project_key: "/Users/patryk/Desktop/Alfred",
        source_id: "codex-cli",
        source_run_id: "thread-1",
        source_event_id: "thread-1:updated",
        type: "run.updated",
        occurred_at: "2026-04-27T20:00:00.000Z"
      }]
    });

    expect(parsed.events[0].privacy_mode).toBe("standard");
  });

  it("defaults field report arrays", () => {
    const parsed = FieldReportSchema.parse({
      source_id: "claude-code",
      summary: "Implemented the runner outbox."
    });

    expect(parsed.completed_work).toEqual([]);
    expect(parsed.confidence).toBe("medium");
  });

  it("denies secret-looking artifacts by default", () => {
    const parsed = PrivacyPolicySchema.parse({});
    expect(parsed.mode).toBe("standard");
    expect(parsed.denied_artifact_globs).toContain(".env");
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd refoundation
pnpm --filter @alfred/schema test
pnpm --filter @alfred/schema typecheck
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add refoundation/packages/schema refoundation/package.json refoundation/pnpm-lock.yaml
git commit -m "feat(schema): add Alfred event contracts"
```

### Task 3: Add Database Package and Postgres Schema

**Files:**

- Create: `refoundation/docker-compose.yml`
- Create: `refoundation/packages/db/package.json`
- Create: `refoundation/packages/db/tsconfig.json`
- Create: `refoundation/packages/db/src/schema.ts`
- Create: `refoundation/packages/db/src/client.ts`
- Create: `refoundation/packages/db/src/index.ts`
- Create: `refoundation/apps/api/drizzle.config.ts`

- [ ] **Step 1: Add local Postgres**

Use:

```yaml
services:
  postgres:
    image: postgres:16
    container_name: alfred-refoundation-postgres
    environment:
      POSTGRES_USER: alfred
      POSTGRES_PASSWORD: alfred
      POSTGRES_DB: alfred
    ports:
      - "54329:5432"
    volumes:
      - alfred-refoundation-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U alfred -d alfred"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  alfred-refoundation-postgres:
```

- [ ] **Step 2: Add Drizzle schema**

Define tables:

- `users`
- `workspaces`
- `devices`
- `projects`
- `missions`
- `runs`
- `run_relations`
- `events`
- `artifacts`
- `field_reports`
- `knowledge_entries`
- `alerts`
- `source_cursors`
- `ingest_batches`

Use UUID primary keys, `created_at`, `updated_at`, and unique constraints:

- `devices.workspace_id + devices.device_key`
- `projects.workspace_id + projects.project_key`
- `runs.workspace_id + runs.source_id + runs.source_run_id`
- `events.workspace_id + events.source_id + events.source_event_id`
- `ingest_batches.workspace_id + ingest_batches.batch_id`

- [ ] **Step 3: Add seed-safe default workspace**

In `packages/db/src/schema.ts`, include stable default IDs for local development in comments:

```ts
export const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000011";
export const LOCAL_DEVICE_ID = "00000000-0000-4000-8000-000000000101";
```

- [ ] **Step 4: Generate migration**

Run:

```bash
cd refoundation
docker compose up -d postgres
pnpm --filter @alfred/db build
pnpm drizzle-kit generate --config apps/api/drizzle.config.ts
pnpm drizzle-kit migrate --config apps/api/drizzle.config.ts
```

Expected: migrations created and applied to local Postgres.

- [ ] **Step 5: Commit**

```bash
git add refoundation/docker-compose.yml refoundation/packages/db refoundation/apps/api/drizzle.config.ts refoundation/drizzle
git commit -m "feat(db): add Alfred cloud schema"
```

### Task 4: Build API Skeleton

**Files:**

- Create: `refoundation/apps/api/package.json`
- Create: `refoundation/apps/api/tsconfig.json`
- Create: `refoundation/apps/api/src/env.ts`
- Create: `refoundation/apps/api/src/app.ts`
- Create: `refoundation/apps/api/src/index.ts`
- Create: `refoundation/apps/api/src/routes/health.ts`
- Create: `refoundation/apps/api/src/auth/device-auth.ts`
- Create: `refoundation/apps/api/src/test/app.test.ts`

- [ ] **Step 1: Add Hono app**

Create `app.ts`:

```ts
import { Hono } from "hono";
import { healthRoutes } from "./routes/health";

export function createApp() {
  const app = new Hono();
  app.route("/health", healthRoutes);
  return app;
}
```

Create `index.ts`:

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./env";

serve({
  fetch: createApp().fetch,
  port: env.API_PORT,
});

console.log(`Alfred API listening on :${env.API_PORT}`);
```

- [ ] **Step 2: Add health route**

```ts
import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => {
  return c.json({
    ok: true,
    service: "alfred-api",
    version: "0.0.0",
  });
});
```

- [ ] **Step 3: Add device auth middleware**

Use bearer token for MVP0:

```ts
import type { MiddlewareHandler } from "hono";

export function requireDeviceToken(expectedToken: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

    if (!token || token !== expectedToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}
```

- [ ] **Step 4: Test API health and auth**

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { requireDeviceToken } from "../src/auth/device-auth";
import { Hono } from "hono";

describe("api", () => {
  it("returns health", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("rejects missing device token", async () => {
    const app = new Hono();
    app.use("/private/*", requireDeviceToken("secret"));
    app.get("/private/ping", (c) => c.json({ ok: true }));

    const res = await app.request("/private/ping");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 5: Run API tests**

```bash
cd refoundation
pnpm --filter @alfred/api test
pnpm --filter @alfred/api typecheck
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add refoundation/apps/api refoundation/package.json refoundation/pnpm-lock.yaml
git commit -m "feat(api): add cloud API skeleton"
```

### Task 5: Implement Ingest API

**Files:**

- Create: `refoundation/apps/api/src/routes/ingest.ts`
- Create: `refoundation/apps/api/src/services/ingest-service.ts`
- Modify: `refoundation/apps/api/src/app.ts`
- Test: `refoundation/apps/api/src/test/ingest.test.ts`

- [ ] **Step 1: Write ingest service test**

Test idempotency:

```ts
it("accepts the same batch twice without duplicating events", async () => {
  const batch = makeBatch("00000000-0000-4000-8000-000000000201");
  const first = await ingestBatch(db, batch);
  const second = await ingestBatch(db, batch);

  expect(first.accepted_events).toBe(1);
  expect(second.accepted_events).toBe(0);
  expect(second.duplicate_batch).toBe(true);
});
```

- [ ] **Step 2: Implement route**

Route shape:

```ts
ingestRoutes.post("/batches", requireDeviceToken(env.RUNNER_DEVICE_TOKEN), async (c) => {
  const body = await c.req.json();
  const batch = IngestBatchSchema.parse(body);
  const result = await ingestBatch(db, batch);
  return c.json(result, 202);
});
```

- [ ] **Step 3: Implement service behavior**

For each event:

1. Upsert project by `workspace_id + project_key`.
2. Upsert run by `workspace_id + source_id + source_run_id`.
3. If `parent_source_run_id` exists, upsert relation after parent run exists.
4. Insert event by unique `workspace_id + source_id + source_event_id`.
5. Mark batch as accepted.

Return:

```ts
{
  batch_id: string;
  accepted_events: number;
  duplicate_events: number;
  duplicate_batch: boolean;
}
```

- [ ] **Step 4: Run ingest tests**

```bash
cd refoundation
pnpm --filter @alfred/api test -- ingest
```

Expected: duplicate batch and duplicate event tests pass.

- [ ] **Step 5: Commit**

```bash
git add refoundation/apps/api/src/routes/ingest.ts refoundation/apps/api/src/services/ingest-service.ts refoundation/apps/api/src/app.ts refoundation/apps/api/src/test/ingest.test.ts
git commit -m "feat(api): ingest runner event batches"
```

### Task 6: Add Query API for Runs, Missions, and Reports

**Files:**

- Create: `refoundation/apps/api/src/routes/runs.ts`
- Create: `refoundation/apps/api/src/routes/missions.ts`
- Create: `refoundation/apps/api/src/routes/reports.ts`
- Create: `refoundation/apps/api/src/services/query-service.ts`
- Modify: `refoundation/apps/api/src/app.ts`
- Test: `refoundation/apps/api/src/test/query-routes.test.ts`

- [ ] **Step 1: Implement read routes**

Routes:

```text
GET  /v1/runs?workspace_id=<uuid>&limit=50
GET  /v1/runs/:runId
GET  /v1/runs/:runId/events
GET  /v1/missions?workspace_id=<uuid>
POST /v1/missions
GET  /v1/reports?workspace_id=<uuid>
POST /v1/reports
```

- [ ] **Step 2: Mission create schema**

Use:

```ts
export const CreateMissionSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  brief: z.string().max(4000).default(""),
  status: z.enum(["backlog", "ready", "claimed", "review", "done"]).default("ready"),
});
```

- [ ] **Step 3: Query route tests**

Assert:

- `GET /v1/runs` returns newest first.
- `GET /v1/runs/:runId/events` returns chronological events.
- `POST /v1/missions` creates a ready mission.
- `POST /v1/reports` accepts `FieldReportSchema`.

- [ ] **Step 4: Run tests**

```bash
cd refoundation
pnpm --filter @alfred/api test -- query-routes
```

Expected: routes pass.

- [ ] **Step 5: Commit**

```bash
git add refoundation/apps/api/src/routes refoundation/apps/api/src/services/query-service.ts refoundation/apps/api/src/app.ts refoundation/apps/api/src/test/query-routes.test.ts
git commit -m "feat(api): expose runs missions and reports"
```

### Task 7: Build Runner Outbox and Sync Client

**Files:**

- Create: `refoundation/apps/runner/package.json`
- Create: `refoundation/apps/runner/tsconfig.json`
- Create: `refoundation/apps/runner/src/env.ts`
- Create: `refoundation/apps/runner/src/config.ts`
- Create: `refoundation/apps/runner/src/outbox/outbox-db.ts`
- Create: `refoundation/apps/runner/src/outbox/outbox-worker.ts`
- Create: `refoundation/apps/runner/src/sync/ingest-client.ts`
- Create: `refoundation/apps/runner/src/index.ts`
- Test: `refoundation/apps/runner/src/test/outbox.test.ts`

- [ ] **Step 1: Implement local outbox SQLite**

Tables:

```sql
create table if not exists outbox_batches (
  id text primary key,
  payload_json text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at text not null,
  last_error text,
  created_at text not null,
  sent_at text
);
```

- [ ] **Step 2: Add outbox operations**

Expose:

```ts
export interface OutboxDb {
  enqueue(batch: IngestBatch): void;
  claimReadyBatch(now: Date): OutboxBatch | null;
  markSent(id: string, now: Date): void;
  markFailed(id: string, error: string, now: Date): void;
}
```

Backoff:

- attempt 1: 5 seconds
- attempt 2: 30 seconds
- attempt 3: 2 minutes
- attempt 4+: 10 minutes

- [ ] **Step 3: Implement ingest client**

`sendBatch(batch)` posts to:

```text
POST ${RUNNER_API_URL}/v1/ingest/batches
Authorization: Bearer ${RUNNER_DEVICE_TOKEN}
Content-Type: application/json
```

Treat HTTP 200, 201, and 202 as success.

- [ ] **Step 4: Test retry behavior**

Test:

- enqueue stores JSON.
- claim returns pending due batch.
- markSent sets `sent_at`.
- markFailed increments attempt and sets future `next_attempt_at`.

- [ ] **Step 5: Commit**

```bash
git add refoundation/apps/runner refoundation/package.json refoundation/pnpm-lock.yaml
git commit -m "feat(runner): add offline ingest outbox"
```

### Task 8: Add Privacy Redactor

**Files:**

- Create: `refoundation/apps/runner/src/privacy/redactor.ts`
- Test: `refoundation/apps/runner/src/test/redactor.test.ts`

- [ ] **Step 1: Implement redaction rules**

Rules:

- Replace values matching `sk-[A-Za-z0-9_-]{20,}` with `<redacted:api-key>`.
- Replace `ANTHROPIC_API_KEY=...` with `ANTHROPIC_API_KEY=<redacted>`.
- Replace `OPENAI_API_KEY=...` with `OPENAI_API_KEY=<redacted>`.
- In `minimal`, remove `payload.transcript`, `payload.command_output`, `payload.diff`.
- In `standard`, keep summaries and file names, remove full transcript/diff/large command output.
- In `full`, still redact secrets but keep allowed payload fields.

- [ ] **Step 2: Add tests**

Test exact cases:

```ts
expect(redactText("OPENAI_API_KEY=sk-abc12345678901234567890")).toBe("OPENAI_API_KEY=<redacted>");
expect(redactPayload({ transcript: "private", summary: "ok" }, "minimal")).toEqual({ summary: "ok" });
expect(redactPayload({ diff: "secret diff", files: ["src/a.ts"] }, "standard")).toEqual({ files: ["src/a.ts"] });
```

- [ ] **Step 3: Wire redactor into outbox enqueue**

Before enqueueing a batch, map every event payload through `redactPayload(event.payload, event.privacy_mode)`.

- [ ] **Step 4: Commit**

```bash
git add refoundation/apps/runner/src/privacy refoundation/apps/runner/src/outbox refoundation/apps/runner/src/test/redactor.test.ts
git commit -m "feat(runner): enforce privacy redaction before sync"
```

### Task 9: Implement Source Adapter Interface

**Files:**

- Create: `refoundation/apps/runner/src/sources/source-adapter.ts`
- Create: `refoundation/packages/adapters/package.json`
- Create: `refoundation/packages/adapters/tsconfig.json`
- Create: `refoundation/packages/adapters/src/normalize.ts`
- Create: `refoundation/packages/adapters/src/index.ts`
- Test: `refoundation/packages/adapters/test/normalize.test.ts`

- [ ] **Step 1: Define adapter interface**

```ts
export interface SourceCursor {
  source_id: AgentSource;
  cursor_key: string;
  cursor_value: string;
}

export interface SourceAdapter {
  sourceId: AgentSource;
  displayName: string;
  discoverRuns(cursor?: SourceCursor): Promise<SourceRunPage>;
  readEvents(sourceRunId: string, cursor?: SourceCursor): Promise<SourceEventPage>;
  healthCheck(): Promise<SourceHealth>;
}
```

- [ ] **Step 2: Define source page types**

```ts
export interface SourceRunPage {
  runs: SourceRun[];
  nextCursor?: SourceCursor;
}

export interface SourceEventPage {
  events: IngestEvent[];
  nextCursor?: SourceCursor;
}

export interface SourceHealth {
  ok: boolean;
  message: string;
  checked_at: string;
}
```

- [ ] **Step 3: Add normalization helpers**

Create helpers:

- `makeRunStartedEvent(input)`
- `makeRunUpdatedEvent(input)`
- `makeRunCompletedEvent(input)`
- `makeSpawnCreatedEvent(input)`

Each helper must generate deterministic `event_id` and `source_event_id` from source/run/type/timestamp.

- [ ] **Step 4: Test deterministic IDs**

Two calls with same input must produce same event ID.

- [ ] **Step 5: Commit**

```bash
git add refoundation/apps/runner/src/sources refoundation/packages/adapters refoundation/package.json refoundation/pnpm-lock.yaml
git commit -m "feat(adapters): define source normalization contract"
```

### Task 10: Implement Claude Code Adapter

**Files:**

- Create: `refoundation/apps/runner/src/sources/claude/claude-adapter.ts`
- Create: `refoundation/apps/runner/src/sources/claude/hook-server.ts`
- Create: `refoundation/apps/runner/src/sources/claude/hooks/alfred_claude_hook.py`
- Test: `refoundation/apps/runner/src/test/claude-adapter.test.ts`

- [ ] **Step 1: Add hook HTTP server**

Runner listens on `127.0.0.1:4317` for:

```text
POST /sources/claude/events
```

The endpoint accepts:

```json
{
  "hook_event": "PreToolUse",
  "session_id": "claude-session-id",
  "cwd": "/Users/patryk/Desktop/Alfred",
  "tool_name": "Bash",
  "summary": "Run tests",
  "occurred_at": "2026-04-27T20:00:00.000Z"
}
```

- [ ] **Step 2: Add Python hook script**

The script reads JSON from stdin and posts to the runner:

```python
import json
import os
import sys
import urllib.request

payload = json.load(sys.stdin)
url = os.environ.get("ALFRED_RUNNER_HOOK_URL", "http://127.0.0.1:4317/sources/claude/events")
data = json.dumps(payload).encode("utf-8")
req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")

try:
    urllib.request.urlopen(req, timeout=1.5).read()
except Exception:
    pass
```

- [ ] **Step 3: Normalize Claude events**

Map:

- `SessionStart` -> `run.started`
- `PreToolUse` -> `tool.started`
- `PostToolUse` -> `tool.completed` or `tool.failed`
- `Notification` -> `agent.waiting`
- `Stop` -> `run.completed`
- `SessionEnd` -> `run.completed`

- [ ] **Step 4: Test mapping**

Fixture input:

```json
{
  "hook_event": "Notification",
  "session_id": "claude-1",
  "cwd": "/Users/patryk/Desktop/Alfred",
  "message": "Claude needs input",
  "occurred_at": "2026-04-27T20:00:00.000Z"
}
```

Expected event:

```json
{
  "source_id": "claude-code",
  "source_run_id": "claude-1",
  "type": "agent.waiting",
  "status": "waiting"
}
```

- [ ] **Step 5: Commit**

```bash
git add refoundation/apps/runner/src/sources/claude refoundation/apps/runner/src/test/claude-adapter.test.ts
git commit -m "feat(runner): collect Claude Code hook events"
```

### Task 11: Implement Codex CLI Adapter

**Files:**

- Create: `refoundation/apps/runner/src/sources/codex/codex-sqlite.ts`
- Create: `refoundation/apps/runner/src/sources/codex/codex-jsonl.ts`
- Create: `refoundation/apps/runner/src/sources/codex/codex-adapter.ts`
- Create: `refoundation/apps/runner/src/test/fixtures/codex-state.sql`
- Create: `refoundation/apps/runner/src/test/fixtures/codex-session.jsonl`
- Test: `refoundation/apps/runner/src/test/codex-adapter.test.ts`

- [ ] **Step 1: Schema introspection first**

Implement:

```ts
export function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(tableName);
  return Boolean(row);
}

export function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`pragma table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}
```

Do not query Codex tables before checking they exist.

- [ ] **Step 2: Read threads defensively**

Query only columns verified present:

- `id`
- `rollout_path`
- `created_at`
- `updated_at`
- `cwd`
- `title`
- `model_provider`
- `model`
- `reasoning_effort`
- `tokens_used`
- `archived`
- `git_branch`
- `git_sha`
- `cli_version`

Map missing values to `undefined`, not crash.

- [ ] **Step 3: Read spawn edges defensively**

If `thread_spawn_edges` exists, map:

- `parent_thread_id`
- `child_thread_id`
- `status`

Create `spawn.created` events with `parent_source_run_id`.

- [ ] **Step 4: Parse JSONL with line-level isolation**

For `~/.codex/sessions/**/*.jsonl`:

- read line by line,
- parse each line independently,
- skip malformed lines,
- emit `source_health` warning count,
- never include raw message content unless privacy mode is `full`.

- [ ] **Step 5: Add fixture tests**

Fixture must contain:

- one thread in `/Users/patryk/Desktop/Alfred`,
- one child thread edge,
- one malformed JSONL line,
- one valid JSONL event.

Expected:

- adapter health remains `ok: true`,
- malformed line increments warning count,
- thread becomes `run.updated`,
- edge becomes `spawn.created`.

- [ ] **Step 6: Commit**

```bash
git add refoundation/apps/runner/src/sources/codex refoundation/apps/runner/src/test/fixtures refoundation/apps/runner/src/test/codex-adapter.test.ts
git commit -m "feat(runner): collect Codex CLI sessions"
```

### Task 12: Runner Main Loop

**Files:**

- Modify: `refoundation/apps/runner/src/index.ts`
- Create: `refoundation/apps/runner/src/config.ts`
- Test: `refoundation/apps/runner/src/test/runner-loop.test.ts`

- [ ] **Step 1: Compose adapters**

Runner startup:

1. Load config.
2. Open outbox.
3. Start Claude hook server.
4. Start MCP server.
5. Poll Codex adapter every 10 seconds.
6. Flush outbox every 5 seconds.

- [ ] **Step 2: Implement source isolation**

Use:

```ts
for (const adapter of adapters) {
  try {
    const page = await adapter.discoverRuns(cursorStore.get(adapter.sourceId));
    enqueuePage(page);
  } catch (error) {
    recordSourceHealth(adapter.sourceId, error);
  }
}
```

Adapter errors must not throw out of the loop.

- [ ] **Step 3: Add health logging**

Every minute log:

```text
Alfred runner: claude-code ok, codex-cli ok, outbox pending=<n>
```

- [ ] **Step 4: Commit**

```bash
git add refoundation/apps/runner/src/index.ts refoundation/apps/runner/src/config.ts refoundation/apps/runner/src/test/runner-loop.test.ts
git commit -m "feat(runner): sync agent sources to cloud"
```

### Task 13: MCP Server for Missions and Reports

**Files:**

- Create: `refoundation/packages/mcp/package.json`
- Create: `refoundation/packages/mcp/tsconfig.json`
- Create: `refoundation/packages/mcp/src/tools.ts`
- Create: `refoundation/packages/mcp/src/index.ts`
- Create: `refoundation/apps/runner/src/mcp/server.ts`
- Test: `refoundation/packages/mcp/test/tools.test.ts`

- [ ] **Step 1: Define MCP tools**

Tools:

```text
alfred_list_missions
alfred_get_mission
alfred_claim_mission
alfred_append_finding
alfred_submit_field_report
alfred_mark_review_needed
alfred_search_project_memory
alfred_add_knowledge_entry
```

- [ ] **Step 2: Add Zod input schemas**

Example:

```ts
export const SubmitFieldReportInput = z.object({
  mission_id: z.string().uuid().optional(),
  run_id: z.string().uuid().optional(),
  source_id: AgentSource,
  summary: z.string().min(1).max(4000),
  completed_work: z.array(z.string()).default([]),
  files_touched: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
});
```

- [ ] **Step 3: Runner MCP implementation**

MCP server calls cloud API through local runner credentials. If cloud is offline, write report/finding actions to outbox with event type:

- `field_report.submitted`
- `alert.raised`

- [ ] **Step 4: Test tool schemas**

Assert:

- invalid UUID rejected,
- empty summary rejected,
- default arrays applied.

- [ ] **Step 5: Commit**

```bash
git add refoundation/packages/mcp refoundation/apps/runner/src/mcp refoundation/package.json refoundation/pnpm-lock.yaml
git commit -m "feat(mcp): expose Alfred missions to agents"
```

### Task 14: Web App Shell

**Files:**

- Create: `refoundation/apps/web/package.json`
- Create: `refoundation/apps/web/tsconfig.json`
- Create: `refoundation/apps/web/next.config.ts`
- Create: `refoundation/apps/web/src/app/layout.tsx`
- Create: `refoundation/apps/web/src/app/page.tsx`
- Create: `refoundation/apps/web/src/app/globals.css`
- Create: `refoundation/apps/web/src/components/app-shell.tsx`
- Create: `refoundation/apps/web/src/lib/api-client.ts`
- Create: `refoundation/apps/web/src/lib/query-client.tsx`

- [ ] **Step 1: Add Next app**

Use App Router with React Server Components enabled by default. Use client components only for interactive data panels.

- [ ] **Step 2: Add API client**

Implement:

```ts
export async function apiGet<T>(path: string): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4301";
  const res = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 3: App shell layout**

Navigation:

- Live
- Runs
- Missions
- Reports
- Settings

Visual direction:

- dense operational UI,
- no marketing hero,
- dark neutral base,
- restrained cyan/amber/lime status colors,
- cards only for repeated items,
- responsive two-column desktop, one-column mobile.

- [ ] **Step 4: Commit**

```bash
git add refoundation/apps/web refoundation/package.json refoundation/pnpm-lock.yaml
git commit -m "feat(web): add Alfred command center shell"
```

### Task 15: Web Live View and Runs

**Files:**

- Modify: `refoundation/apps/web/src/app/page.tsx`
- Create: `refoundation/apps/web/src/app/runs/[runId]/page.tsx`
- Create: `refoundation/apps/web/src/components/live-run-list.tsx`
- Create: `refoundation/apps/web/src/components/run-timeline.tsx`
- Test: `refoundation/apps/web/src/test/live-run-list.test.tsx`

- [ ] **Step 1: Live run list**

Show:

- status pill,
- source badge,
- title,
- cwd/project,
- model/reasoning,
- last seen,
- event count,
- waiting indicator.

- [ ] **Step 2: Empty state**

If no runs:

```text
No agent runs yet. Start Claude Code or Codex with the Alfred runner active.
```

- [ ] **Step 3: Run detail**

Sections:

- header metadata,
- timeline,
- files/artifacts summary,
- field report,
- source health note for best-effort adapters.

- [ ] **Step 4: Component test**

Test that a Codex run and Claude run render different source badges and status labels.

- [ ] **Step 5: Commit**

```bash
git add refoundation/apps/web/src/app refoundation/apps/web/src/components refoundation/apps/web/src/test/live-run-list.test.tsx
git commit -m "feat(web): show unified agent live view"
```

### Task 16: Web Missions and Reports

**Files:**

- Create: `refoundation/apps/web/src/app/missions/page.tsx`
- Create: `refoundation/apps/web/src/app/reports/page.tsx`
- Create: `refoundation/apps/web/src/components/mission-board.tsx`
- Test: `refoundation/apps/web/src/test/mission-board.test.tsx`

- [ ] **Step 1: Mission board columns**

Columns:

- Ready
- Claimed
- Review
- Done

Cards show:

- title,
- project,
- assigned source if claimed,
- last report time,
- review flag.

- [ ] **Step 2: Reports list**

Show:

- summary,
- completed work,
- risks,
- blockers,
- next steps,
- confidence,
- source/run link.

- [ ] **Step 3: Mobile layout**

On narrow screens, render mission columns as tabs instead of horizontal board.

- [ ] **Step 4: Commit**

```bash
git add refoundation/apps/web/src/app/missions refoundation/apps/web/src/app/reports refoundation/apps/web/src/components/mission-board.tsx refoundation/apps/web/src/test/mission-board.test.tsx
git commit -m "feat(web): add missions and field reports"
```

### Task 17: PWA Baseline for Desktop/Web/Mobile

**Files:**

- Create: `refoundation/apps/web/public/manifest.webmanifest`
- Create: `refoundation/apps/web/public/icon-192.png`
- Create: `refoundation/apps/web/public/icon-512.png`
- Modify: `refoundation/apps/web/src/app/layout.tsx`
- Test: `refoundation/apps/web/e2e/responsive.spec.ts`

- [ ] **Step 1: Add manifest**

Use:

```json
{
  "name": "Alfred",
  "short_name": "Alfred",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#07080A",
  "theme_color": "#0F1114",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Add responsive test**

Use Playwright to open:

- `390x844` mobile
- `768x1024` tablet
- `1440x900` desktop

Assert:

- nav visible,
- Live list visible,
- no horizontal overflow,
- mission columns collapse to tabs on mobile.

- [ ] **Step 3: Commit**

```bash
git add refoundation/apps/web/public refoundation/apps/web/src/app/layout.tsx refoundation/apps/web/e2e
git commit -m "feat(web): make Alfred installable as PWA"
```

### Task 18: End-to-End Dogfood Flow

**Files:**

- Create: `refoundation/scripts/dev-seed.ts`
- Create: `refoundation/scripts/smoke-mvp0.sh`
- Modify: `refoundation/package.json`
- Update: `refoundation/README.md`

- [ ] **Step 1: Seed script**

Create seed data:

- local user,
- personal workspace,
- local device,
- one project for `/Users/patryk/Desktop/Alfred`,
- one ready mission,
- one Claude sample run,
- one Codex sample run,
- one field report.

- [ ] **Step 2: Smoke script**

Run:

```bash
docker compose up -d postgres
pnpm install
pnpm build
pnpm test
pnpm --filter @alfred/api dev &
pnpm --filter @alfred/web dev &
pnpm --filter @alfred/runner dev &
```

Then:

- POST sample ingest batch.
- GET `/v1/runs`.
- Open web app with Playwright.
- Assert both Claude and Codex runs visible.

- [ ] **Step 3: README quickstart**

Include:

```bash
cd refoundation
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm build
pnpm test
pnpm dev
```

Local URLs:

- web: `http://127.0.0.1:4300`
- api: `http://127.0.0.1:4301/health`
- runner hook: `http://127.0.0.1:4317/sources/claude/events`

- [ ] **Step 4: Commit**

```bash
git add refoundation/scripts refoundation/package.json refoundation/README.md
git commit -m "test: add MVP0 dogfood smoke flow"
```

## 8. Verification Matrix

Run before calling MVP0 complete:

```bash
cd refoundation
pnpm typecheck
pnpm test
pnpm build
```

Run API health:

```bash
curl -sS http://127.0.0.1:4301/health
```

Expected:

```json
{"ok":true,"service":"alfred-api","version":"0.0.0"}
```

Run ingest smoke:

```bash
curl -sS -X POST http://127.0.0.1:4301/v1/ingest/batches \
  -H "Authorization: Bearer dev-device-token" \
  -H "Content-Type: application/json" \
  --data @scripts/fixtures/sample-ingest-batch.json
```

Expected:

```json
{"accepted_events":2,"duplicate_events":0,"duplicate_batch":false}
```

Manual dogfood:

- Start runner.
- Start Claude Code in this repo.
- Start Codex in this repo.
- Confirm both appear in Live.
- Create one mission in web.
- Use MCP tool `alfred_claim_mission` from an agent.
- Use MCP tool `alfred_submit_field_report`.
- Confirm report appears in web.

## 9. Risk Controls

### Codex schema drift

Controls:

- introspect tables and columns,
- test missing-column scenarios,
- report source health in UI,
- isolate adapter errors.

### Privacy leak

Controls:

- redaction before outbox,
- `standard` default,
- denied artifact globs,
- no transcript/diff in minimal/standard,
- tests for key redaction.

### Scope creep

Controls:

- no mobile native app in MVP0,
- no hosted executor,
- no team billing,
- no orchestration UI,
- no eval/replay engine.

### Runner reliability

Controls:

- SQLite outbox,
- retry backoff,
- source isolation,
- idempotent ingest,
- health logs.

## 10. Implementation Order

Recommended execution:

1. Task 1 - workspace.
2. Task 2 - schema.
3. Task 3 - database.
4. Task 4 - API skeleton.
5. Task 5 - ingest.
6. Task 7 - outbox.
7. Task 8 - privacy.
8. Task 9 - source adapter contract.
9. Task 11 - Codex adapter.
10. Task 10 - Claude adapter.
11. Task 12 - runner loop.
12. Task 6 - query API.
13. Task 13 - MCP.
14. Task 14 - web shell.
15. Task 15 - Live/Runs.
16. Task 16 - Missions/Reports.
17. Task 17 - PWA.
18. Task 18 - dogfood smoke.

Codex adapter is intentionally before Claude adapter in implementation order because the user explicitly wants Codex working from day one, and Codex has the highest schema-drift risk.

## 11. Acceptance Criteria

MVP0 is complete when:

- `pnpm typecheck`, `pnpm test`, and `pnpm build` pass in `refoundation/`.
- API accepts ingest batches idempotently.
- Runner can enqueue while API is down and flush when API returns.
- Codex adapter reads fixture SQLite/JSONL without crashing on malformed lines.
- Claude hook endpoint converts hook payloads to Alfred events.
- Both sources appear in `/v1/runs`.
- Web Live view shows one Claude run and one Codex run.
- Run detail shows timeline events.
- Mission board can create and display a mission.
- MCP can claim a mission and submit a field report.
- Standard privacy mode does not sync raw transcript or diff.
- Responsive web works at mobile, tablet, and desktop widths.

## 12. First Execution Recommendation

Start with Tasks 1-5 in one implementation pass. That creates the stable contract and ingest path. Then implement Tasks 7-11 so local data can flow. Only after real runner data exists should the web UI be built beyond the shell.

This avoids polishing an empty dashboard and keeps the project honest: Alfred becomes useful when Claude and Codex events flow into one model.
