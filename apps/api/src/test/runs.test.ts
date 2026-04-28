import { describe, expect, it } from "vitest";

import { createRunsRoutes } from "../routes/runs";
import type {
  RunDetail,
  RunListItem,
  RunsListFilters,
  RunsQueryStore,
} from "../services/runs-query-service";

const baseRun: RunListItem = {
  id: "run-1",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  project_id: "project-1",
  project_key: "Alfred",
  project_name: "Alfred",
  source_id: "codex-cli",
  source_run_id: "codex-run-1",
  status: "running",
  title: null,
  started_at: "2026-04-28T10:00:00.000Z",
  completed_at: null,
  updated_at: "2026-04-28T10:01:00.000Z",
  created_at: "2026-04-28T10:00:00.000Z",
};

function createStore(): RunsQueryStore & {
  observedLimits: number[];
  observedFilters: RunsListFilters[];
} {
  const observedLimits: number[] = [];
  const observedFilters: RunsListFilters[] = [];
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
    listRuns: async (limit, filters = {}) => {
      observedLimits.push(limit);
      observedFilters.push(filters);
      return [baseRun].slice(0, limit);
    },
    getRun: async (runId) => (runId === baseRun.id ? runDetail : null),
  };
}

describe("runs routes", () => {
  it("lists runs", async () => {
    const store = createStore();
    const app = createRunsRoutes(store);

    const response = await app.request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [baseRun] });
    expect(store.observedLimits).toEqual([25]);
  });

  it("caps list limit", async () => {
    const store = createStore();
    const app = createRunsRoutes(store);

    const response = await app.request("/?limit=250");

    expect(response.status).toBe(200);
    expect(store.observedLimits).toEqual([100]);
  });

  it("passes optional filters to the store", async () => {
    const store = createStore();
    const app = createRunsRoutes(store);

    const response = await app.request(
      "/?since=2026-04-28T00:00:00.000Z&source=codex-cli&status=running&project=Alfred",
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
    const app = createRunsRoutes(store);

    const response = await app.request("/?since=not-a-date");

    expect(response.status).toBe(400);
    expect(store.observedFilters).toEqual([]);
  });

  it("rejects an invalid source value", async () => {
    const store = createStore();
    const app = createRunsRoutes(store);

    const response = await app.request("/?source=nope");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_source" });
    expect(store.observedFilters).toEqual([]);
  });

  it("rejects an invalid status value", async () => {
    const store = createStore();
    const app = createRunsRoutes(store);

    const response = await app.request("/?status=nope");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_status" });
    expect(store.observedFilters).toEqual([]);
  });

  it("omits filters when no query params are provided", async () => {
    const store = createStore();
    const app = createRunsRoutes(store);

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(store.observedFilters).toEqual([{}]);
  });

  it("returns run detail with timeline events", async () => {
    const app = createRunsRoutes(createStore());

    const response = await app.request("/run-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "run-1",
      source_id: "codex-cli",
      events: [
        { type: "run.started", payload: { tool_name: "session" } },
        { type: "tool.started", payload: { tool_name: "exec_command" } },
      ],
    });
  });

  it("returns 404 for missing runs", async () => {
    const app = createRunsRoutes(createStore());

    const response = await app.request("/missing-run");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });
});
