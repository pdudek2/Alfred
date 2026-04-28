import { createDb, type Database } from "@alfred/db";
import { Hono } from "hono";

import {
  createRunsQueryStore,
  type RunsQueryStore,
} from "../services/runs-query-service";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function createRunsRoutes(db: Database | RunsQueryStore = createDb()) {
  const runsRoutes = new Hono();
  const store = isRunsQueryStore(db) ? db : createRunsQueryStore(db);

  runsRoutes.get("/", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    const items = await store.listRuns(limit);
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
