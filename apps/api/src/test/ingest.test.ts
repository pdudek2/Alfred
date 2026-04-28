import { IngestBatchSchema, type IngestBatch } from "@alfred/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createIngestRoutes } from "../routes/ingest";
import { ingestBatch, type IngestStore } from "../services/ingest-service";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000101";

type BatchEventOverrides = Partial<IngestBatch["events"][number]>;

function makeBatch(
  batchId = "00000000-0000-4000-8000-000000000201",
  eventOverrides: BatchEventOverrides = {},
): IngestBatch {
  return IngestBatchSchema.parse({
    batch_id: batchId,
    workspace_id: workspaceId,
    device_id: deviceId,
    sent_at: "2026-01-01T10:00:00.000Z",
    events: [
      {
        event_id: "event-000000000001",
        workspace_id: workspaceId,
        device_id: deviceId,
        project_key: "alfred",
        source_id: "codex-cli",
        source_run_id: "run-1",
        source_event_id: "source-event-1",
        type: "run.started",
        status: "running",
        privacy_mode: "standard",
        occurred_at: "2026-01-01T10:00:00.000Z",
        payload: { cwd: "/Users/patryk/Desktop/Alfred" },
        ...eventOverrides,
      },
    ],
  });
}

type InMemoryRun = {
  id: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
};

function runStatusForTest(event: IngestBatch["events"][number]) {
  if (event.status) return event.status;
  if (event.type === "run.started") return "running";
  if (event.type === "run.completed") return "completed";
  if (event.type === "run.failed") return "failed";
  if (event.type === "agent.waiting") return "waiting";
  return "unknown";
}

function runTimestampsForTest(event: IngestBatch["events"][number]) {
  const occurredAt = new Date(event.occurred_at);
  return {
    startedAt: event.type === "run.started" ? occurredAt : null,
    completedAt: event.type === "run.completed" || event.type === "run.failed" ? occurredAt : null,
  };
}

function makeInMemoryStore(): IngestStore & { getRun: (key: string) => InMemoryRun | undefined } {
  const batches = new Set<string>();
  const events = new Set<string>();
  const projects = new Map<string, { id: string }>();
  const runs = new Map<string, InMemoryRun>();
  const relations = new Set<string>();

  const store: IngestStore & { getRun: (key: string) => InMemoryRun | undefined } = {
    transaction: async (fn) => fn(store),
    insertBatchIfNew: async (batch) => {
      const key = `${batch.workspace_id}:${batch.batch_id}`;
      if (batches.has(key)) return false;
      batches.add(key);
      return true;
    },
    markBatchAccepted: async () => undefined,
    ensureWorkspace: async () => undefined,
    ensureDevice: async () => undefined,
    upsertProject: async (event) => {
      const key = `${event.workspace_id}:${event.project_key}`;
      const existing = projects.get(key);
      if (existing) return existing;
      const project = { id: `project-${projects.size + 1}` };
      projects.set(key, project);
      return project;
    },
    upsertRun: async (event) => {
      const key = `${event.workspace_id}:${event.source_id}:${event.source_run_id}`;
      const timestamps = runTimestampsForTest(event);
      const existing = runs.get(key);
      if (existing) {
        existing.status = runStatusForTest(event);
        existing.startedAt = timestamps.startedAt ?? existing.startedAt;
        existing.completedAt = timestamps.completedAt ?? existing.completedAt;
        return existing;
      }
      const run = {
        id: `run-${runs.size + 1}`,
        status: runStatusForTest(event),
        startedAt: timestamps.startedAt,
        completedAt: timestamps.completedAt,
      };
      runs.set(key, run);
      return run;
    },
    upsertRelation: async (_event, parentRunId, childRunId) => {
      relations.add(`${parentRunId}:${childRunId}:parent`);
    },
    insertEvent: async (event) => {
      const sourceKey = `${event.workspace_id}:${event.source_id}:${event.source_event_id}`;
      const eventKey = `${event.workspace_id}:${event.event_id}`;
      if (events.has(sourceKey) || events.has(eventKey)) return false;
      events.add(sourceKey);
      events.add(eventKey);
      return true;
    },
    getRun: (key) => runs.get(key),
  };
  return store;
}

describe("ingest", () => {
  it("accepts the same batch twice without duplicating events", async () => {
    const db = makeInMemoryStore();
    const batch = makeBatch("00000000-0000-4000-8000-000000000201");
    const first = await ingestBatch(db, batch);
    const second = await ingestBatch(db, batch);

    expect(first.accepted_events).toBe(1);
    expect(second.accepted_events).toBe(0);
    expect(second.duplicate_batch).toBe(true);
  });

  it("updates an existing run with completion status and timestamp", async () => {
    const db = makeInMemoryStore();

    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000201", {
        source_event_id: "source-event-started",
        event_id: "event-000000000001",
        type: "run.started",
        status: "running",
        occurred_at: "2026-01-01T10:00:00.000Z",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000202", {
        source_event_id: "source-event-completed",
        event_id: "event-000000000002",
        type: "run.completed",
        status: "completed",
        occurred_at: "2026-01-01T10:05:00.000Z",
      }),
    );

    const run = db.getRun(`${workspaceId}:codex-cli:run-1`);
    expect(run).toMatchObject({
      status: "completed",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      completedAt: new Date("2026-01-01T10:05:00.000Z"),
    });
  });

  it("counts duplicate events across different batches", async () => {
    const db = makeInMemoryStore();
    const first = await ingestBatch(db, makeBatch("00000000-0000-4000-8000-000000000201"));
    const second = await ingestBatch(db, makeBatch("00000000-0000-4000-8000-000000000202"));

    expect(first).toMatchObject({
      accepted_events: 1,
      duplicate_events: 0,
      duplicate_batch: false,
    });
    expect(second).toMatchObject({
      accepted_events: 0,
      duplicate_events: 1,
      duplicate_batch: false,
    });
  });

  it("mounts POST /v1/ingest/batches and requires a device token", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeInMemoryStore(), "secret"));

    const unauthorized = await app.request("/v1/ingest/batches", {
      method: "POST",
      body: JSON.stringify(makeBatch()),
      headers: { "content-type": "application/json" },
    });

    expect(unauthorized.status).toBe(401);

    const accepted = await app.request("/v1/ingest/batches", {
      method: "POST",
      body: JSON.stringify(makeBatch()),
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
    });

    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      batch_id: "00000000-0000-4000-8000-000000000201",
      accepted_events: 1,
      duplicate_batch: false,
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeInMemoryStore(), "secret"));

    const response = await app.request("/v1/ingest/batches", {
      method: "POST",
      body: "{",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_body" });
  });

  it("returns 400 for schema-invalid JSON", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeInMemoryStore(), "secret"));

    const response = await app.request("/v1/ingest/batches", {
      method: "POST",
      body: JSON.stringify({ batch_id: "not-enough" }),
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_body" });
  });
});
