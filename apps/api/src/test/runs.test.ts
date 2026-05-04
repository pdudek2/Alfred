import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { createRunsRoutes } from "../routes/runs";
import type { AuthSessionStore } from "../auth/session-auth";
import type {
  RunDetail,
  RunListItem,
  RunsListFilters,
  RunsQueryStore,
} from "../services/runs-query-service";
import { deriveRunLifecycleStatus, userVisibleRunCondition } from "../services/runs-query-service";

const baseRun: RunListItem = {
  id: "00000000-0000-4000-8000-000000000301",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  project_id: "project-1",
  project_key: "Alfred",
  project_name: "Alfred",
  source_id: "codex-cli",
  source_run_id: "codex-run-1",
  status: "running",
  lifecycle_status: "running",
  title: null,
  started_at: "2026-04-28T10:00:00.000Z",
  completed_at: null,
  last_activity_at: "2026-04-28T10:00:01.000Z",
  updated_at: "2026-04-28T10:01:00.000Z",
  created_at: "2026-04-28T10:00:00.000Z",
};

function createStore(): RunsQueryStore & {
  observedLimits: number[];
  observedFilters: RunsListFilters[];
  observedWorkspaceIds: string[];
} {
  const observedLimits: number[] = [];
  const observedFilters: RunsListFilters[] = [];
  const observedWorkspaceIds: string[] = [];
  const runDetail: RunDetail = {
    ...baseRun,
    events: [
      {
        id: "event-1",
        event_id: "event-000000000001",
        source_event_id: "source-event-1",
        type: "run.started",
        status: "running",
        occurred_at: "2026-04-28T10:00:00.000Z",
        payload: { tool_name: "session" },
      },
      {
        id: "event-2",
        event_id: "event-000000000002",
        source_event_id: "source-event-2",
        type: "tool.started",
        status: null,
        occurred_at: "2026-04-28T10:00:01.000Z",
        payload: { tool_name: "exec_command" },
      },
    ],
  };

  return {
    observedLimits,
    observedFilters,
    observedWorkspaceIds,
    listRuns: async (workspaceId, limit, filters = {}) => {
      observedWorkspaceIds.push(workspaceId);
      observedLimits.push(limit);
      observedFilters.push(filters);
      return [baseRun].slice(0, limit);
    },
    getRun: async (workspaceId, runId) => {
      observedWorkspaceIds.push(workspaceId);
      return runId === baseRun.id ? runDetail : null;
    },
  };
}

function createSessionStore(workspaceId = baseRun.workspace_id): AuthSessionStore {
  return {
    getSession: async (token) =>
      token === "valid-session"
        ? {
            sessionId: "session-1",
            userId: "user-1",
            email: "patryk@example.com",
            workspaceId,
          }
        : null,
  };
}

const sessionHeaders = { cookie: "alfred_session=valid-session" };

describe("runs routes", () => {
  it("lists runs", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/", { headers: sessionHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [baseRun] });
    expect(store.observedLimits).toEqual([25]);
    expect(store.observedWorkspaceIds).toEqual([baseRun.workspace_id]);
  });

  it("requires a session before listing runs", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(store.observedLimits).toEqual([]);
  });

  it("treats malformed session cookies as unauthorized", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/", { headers: { cookie: "alfred_session=%E0%A4%A" } });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(store.observedLimits).toEqual([]);
  });

  it("caps list limit", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/?limit=250", { headers: sessionHeaders });

    expect(response.status).toBe(200);
    expect(store.observedLimits).toEqual([100]);
  });

  it("rejects invalid list limits", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/?limit=abc", { headers: sessionHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_limit" });
    expect(store.observedLimits).toEqual([]);
  });

  it("passes optional filters to the store", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request(
      "/?since=2026-04-28T00:00:00.000Z&source=codex-cli&status=running&project=Alfred",
      { headers: sessionHeaders },
    );

    expect(response.status).toBe(200);
    expect(store.observedFilters).toEqual([
      {
        since: new Date("2026-04-28T00:00:00.000Z"),
        source: "codex-cli",
        status: "running",
        projectKey: "Alfred",
      },
    ]);
  });

  it("rejects an invalid since value", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/?since=not-a-date", { headers: sessionHeaders });

    expect(response.status).toBe(400);
    expect(store.observedFilters).toEqual([]);
  });

  it("rejects an invalid source value", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/?source=nope", { headers: sessionHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_source" });
    expect(store.observedFilters).toEqual([]);
  });

  it("rejects an invalid status value", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/?status=nope", { headers: sessionHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_status" });
    expect(store.observedFilters).toEqual([]);
  });

  it("omits filters when no query params are provided", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/", { headers: sessionHeaders });

    expect(response.status).toBe(200);
    expect(store.observedFilters).toEqual([{}]);
  });

  it("returns run detail with timeline events", async () => {
    const app = createRunsRoutes(createStore(), { sessionStore: createSessionStore() });

    const response = await app.request(`/${baseRun.id}`, { headers: sessionHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: baseRun.id,
      source_id: "codex-cli",
      events: [
        { type: "run.started", payload: { tool_name: "session" } },
        { type: "tool.started", payload: { tool_name: "exec_command" } },
      ],
    });
  });

  it("returns 404 for missing runs", async () => {
    const app = createRunsRoutes(createStore(), { sessionStore: createSessionStore() });

    const response = await app.request("/00000000-0000-4000-8000-000000000302", { headers: sessionHeaders });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("rejects malformed run ids before querying the store", async () => {
    const store = createStore();
    const app = createRunsRoutes(store, { sessionStore: createSessionStore() });

    const response = await app.request("/not-a-uuid", { headers: sessionHeaders });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_run_id" });
    expect(store.observedWorkspaceIds).toEqual([]);
  });
});

describe("deriveRunLifecycleStatus", () => {
  const now = new Date("2026-04-28T12:00:00.000Z");

  it("marks active running and waiting runs as stale after two hours without activity", () => {
    expect(
      deriveRunLifecycleStatus(
        { status: "waiting", lastActivityAt: "2026-04-28T09:59:59.000Z" },
        now,
      ),
    ).toBe("stale");
    expect(
      deriveRunLifecycleStatus(
        { status: "running", lastActivityAt: "2026-04-28T09:59:59.000Z" },
        now,
      ),
    ).toBe("stale");
  });

  it("keeps active runs live inside the stale threshold", () => {
    expect(
      deriveRunLifecycleStatus(
        { status: "waiting", lastActivityAt: "2026-04-28T10:00:00.000Z" },
        now,
      ),
    ).toBe("waiting");
    expect(
      deriveRunLifecycleStatus(
        { status: "running", lastActivityAt: "2026-04-28T10:30:00.000Z" },
        now,
      ),
    ).toBe("running");
  });

  it("treats unknown completed rows as completed for compatibility with old imports", () => {
    expect(
      deriveRunLifecycleStatus(
        {
          status: "unknown",
          completedAt: "2026-04-28T10:30:00.000Z",
          lastActivityAt: "2026-04-28T10:30:00.000Z",
        },
        now,
      ),
    ).toBe("completed");
  });
});

describe("userVisibleRunCondition", () => {
  it("excludes synthetic ops smoke runs from user-facing run queries", () => {
    expect(normalizeSql(userVisibleRunCondition())).toContain('"projects"."project_key" is distinct from $1');
  });
});

function normalizeSql(value: SQL): string {
  return new PgDialect().sqlToQuery(value).sql.replace(/\s+/g, " ").trim();
}
