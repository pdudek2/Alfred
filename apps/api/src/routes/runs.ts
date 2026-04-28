import { createDb, type Database } from "@alfred/db";
import { AgentSource, RunStatus } from "@alfred/schema";
import { Hono } from "hono";

import {
  createRunsQueryStore,
  type RunsListFilters,
  type RunsQueryStore,
} from "../services/runs-query-service";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function createRunsRoutes(db: Database | RunsQueryStore = createDb()) {
  const runsRoutes = new Hono();
  const store = isRunsQueryStore(db) ? db : createRunsQueryStore(db);

  runsRoutes.get("/", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    const filters: RunsListFilters = {};

    const sinceRaw = c.req.query("since");
    if (sinceRaw !== undefined) {
      const parsed = new Date(sinceRaw);
      if (Number.isNaN(parsed.getTime())) {
        return c.json({ error: "invalid_since" }, 400);
      }
      filters.since = parsed;
    }

    const source = c.req.query("source");
    if (source) {
      const parsed = AgentSource.safeParse(source);
      if (!parsed.success) {
        return c.json({ error: "invalid_source" }, 400);
      }
      filters.source = parsed.data;
    }

    const status = c.req.query("status");
    if (status) {
      const parsed = RunStatus.safeParse(status);
      if (!parsed.success) {
        return c.json({ error: "invalid_status" }, 400);
      }
      filters.status = parsed.data;
    }

    const project = c.req.query("project");
    if (project) filters.projectKey = project;

    const items = await store.listRuns(limit, filters);
    return c.json({ items });
  });

  runsRoutes.get("/:runId", async (c) => {
    const run = await store.getRun(c.req.param("runId"));
    if (!run) {
      return c.json({ error: "not_found" }, 404);
    }

    return c.json(run);
  });

  return runsRoutes;
}

function isRunsQueryStore(value: Database | RunsQueryStore): value is RunsQueryStore {
  return "listRuns" in value;
}

function parseLimit(value: string | undefined): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}
