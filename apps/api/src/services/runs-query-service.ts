import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import type { AgentSource, RunStatus } from "@alfred/schema";
import {
  events,
  projects,
  runs,
  type Database,
} from "@alfred/db";

export type RunsListFilters = {
  since?: Date;
  source?: AgentSource;
  status?: RunStatus;
  projectKey?: string;
};

export type RunListItem = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  project_key: string | null;
  project_name: string | null;
  source_id: string;
  source_run_id: string;
  status: string;
  title: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
  updated_at: string;
  created_at: string;
};

export type RunEventItem = {
  id: string;
  event_id: string;
  source_event_id: string;
  type: string;
  status: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export type RunDetail = RunListItem & {
  events: RunEventItem[];
};

export type RunsQueryStore = {
  listRuns(workspaceId: string, limit: number, filters?: RunsListFilters): Promise<RunListItem[]>;
  getRun(workspaceId: string, runId: string): Promise<RunDetail | null>;
};

type RunRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  projectKey: string | null;
  projectName: string | null;
  sourceId: string;
  sourceRunId: string;
  status: string;
  title: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastActivityAt: Date | string | null;
  updatedAt: Date;
  createdAt: Date;
};

type EventRow = {
  id: string;
  eventId: string;
  sourceEventId: string;
  type: string;
  status: string | null;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export function createRunsQueryStore(db: Database): RunsQueryStore {
  return {
    listRuns: async (workspaceId, limit, filters = {}) => {
      const latestEvents = latestEventsForWorkspace(db, workspaceId);
      const lastActivityExpr = sql<Date>`coalesce(${latestEvents.lastActivityAt}, ${runs.updatedAt})`;
      const conditions: SQL[] = [eq(runs.workspaceId, workspaceId)];
      if (filters.since) {
        conditions.push(gte(lastActivityExpr, filters.since));
      }
      if (filters.source) {
        conditions.push(eq(runs.sourceId, filters.source));
      }
      if (filters.status) {
        conditions.push(eq(runs.status, filters.status));
      }
      if (filters.projectKey) {
        conditions.push(eq(projects.projectKey, filters.projectKey));
      }

      const rows = await db
        .select({
          id: runs.id,
          workspaceId: runs.workspaceId,
          projectId: runs.projectId,
          projectKey: projects.projectKey,
          projectName: projects.name,
          sourceId: runs.sourceId,
          sourceRunId: runs.sourceRunId,
          status: runs.status,
          title: runs.title,
          startedAt: runs.startedAt,
          completedAt: runs.completedAt,
          lastActivityAt: latestEvents.lastActivityAt,
          updatedAt: runs.updatedAt,
          createdAt: runs.createdAt,
        })
        .from(runs)
        .leftJoin(projects, eq(runs.projectId, projects.id))
        .leftJoin(latestEvents, eq(runs.id, latestEvents.runId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(lastActivityExpr))
        .limit(limit);

      return rows.map(mapRunRow);
    },

    getRun: async (workspaceId, runId) => {
      const latestEvents = latestEventsForWorkspace(db, workspaceId);
      const [run] = await db
        .select({
          id: runs.id,
          workspaceId: runs.workspaceId,
          projectId: runs.projectId,
          projectKey: projects.projectKey,
          projectName: projects.name,
          sourceId: runs.sourceId,
          sourceRunId: runs.sourceRunId,
          status: runs.status,
          title: runs.title,
          startedAt: runs.startedAt,
          completedAt: runs.completedAt,
          lastActivityAt: latestEvents.lastActivityAt,
          updatedAt: runs.updatedAt,
          createdAt: runs.createdAt,
        })
        .from(runs)
        .leftJoin(projects, eq(runs.projectId, projects.id))
        .leftJoin(latestEvents, eq(runs.id, latestEvents.runId))
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)))
        .limit(1);

      if (!run) return null;

      const runEvents = await db
        .select({
          id: events.id,
          eventId: events.eventId,
          sourceEventId: events.sourceEventId,
          type: events.type,
          status: events.status,
          occurredAt: events.occurredAt,
          payload: events.payload,
        })
        .from(events)
        .where(and(eq(events.workspaceId, workspaceId), eq(events.runId, runId)))
        .orderBy(events.occurredAt);

      return {
        ...mapRunRow(run),
        events: runEvents.map(mapEventRow),
      };
    },
  };
}

function latestEventsForWorkspace(db: Database, workspaceId: string) {
  return db
    .select({
      runId: events.runId,
      lastActivityAt: sql<Date | null>`max(${events.occurredAt})`.as("last_activity_at"),
    })
    .from(events)
    .where(eq(events.workspaceId, workspaceId))
    .groupBy(events.runId)
    .as("latest_events");
}

function mapRunRow(row: RunRow): RunListItem {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    project_id: row.projectId,
    project_key: row.projectKey,
    project_name: row.projectName,
    source_id: row.sourceId,
    source_run_id: row.sourceRunId,
    status: row.status,
    title: row.title,
    started_at: toIso(row.startedAt),
    completed_at: toIso(row.completedAt),
    last_activity_at: toIso(row.lastActivityAt),
    updated_at: row.updatedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  };
}

function mapEventRow(row: EventRow): RunEventItem {
  return {
    id: row.id,
    event_id: row.eventId,
    source_event_id: row.sourceEventId,
    type: row.type,
    status: row.status,
    occurred_at: row.occurredAt.toISOString(),
    payload: row.payload,
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
