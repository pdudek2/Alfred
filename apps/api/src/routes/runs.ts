import { type Database } from "@alfred/db";
import { AgentSource, RunStatus } from "@alfred/schema";
import { Hono } from "hono";

import { requireSession, type AuthSessionStore, type AuthVariables } from "../auth/session-auth.js";
import {
  createRunsQueryStore,
  type RunsListFilters,
  type RunsQueryStore,
} from "../services/runs-query-service.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_EVENT_LIMIT = 500;
const MAX_EVENT_LIMIT = 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RunsRouteOptions = {
  sessionStore: AuthSessionStore;
};

export function createRunsRoutes(db: Database | RunsQueryStore, options: RunsRouteOptions) {
  const runsRoutes = new Hono<{ Variables: AuthVariables }>();
  const store = isRunsQueryStore(db) ? db : createRunsQueryStore(db);

  runsRoutes.use("*", requireSession(options.sessionStore));

  runsRoutes.get("/", async (c) => {
    const limit = parseLimit(c.req.query("limit"));
    if (limit === null) {
      return c.json({ error: "invalid_limit" }, 400);
    }

    const filters: RunsListFilters = {};
    const auth = c.get("auth");

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

    const items = await store.listRuns(auth.workspaceId, limit, filters);
    return c.json({ items });
  });

  runsRoutes.get("/:runId", async (c) => {
    const runId = c.req.param("runId");
    if (!UUID_PATTERN.test(runId)) {
      return c.json({ error: "invalid_run_id" }, 400);
    }

    const auth = c.get("auth");
    const eventLimit = parseBoundedInteger(c.req.query("eventLimit"), DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT);
    if (eventLimit === null) {
      return c.json({ error: "invalid_event_limit" }, 400);
    }
    const eventCursor = parseCursor(c.req.query("eventCursor"));
    if (eventCursor === null) {
      return c.json({ error: "invalid_event_cursor" }, 400);
    }

    const run = await store.getRun(auth.workspaceId, runId, { eventLimit, eventCursor });
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

function parseLimit(value: string | undefined): number | null {
  return parseBoundedInteger(value, DEFAULT_LIMIT, MAX_LIMIT);
}

function parseBoundedInteger(value: string | undefined, fallback: number, max: number): number | null {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.min(parsed, max);
}

function parseCursor(value: string | undefined): number | null {
  if (!value) return 0;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
