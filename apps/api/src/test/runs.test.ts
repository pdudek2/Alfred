import { describe, expect, it } from "vitest";

import { createRunsRoutes } from "../routes/runs";
import type { RunDetail, RunListItem, RunsQueryStore } from "../services/runs-query-service";

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

function createStore(): RunsQueryStore & { observedLimits: number[] } {
  const observedLimits: number[] = [];
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
    listRuns: async (limit) => {
      observedLimits.push(limit);
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
