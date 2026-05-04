import { IngestBatchSchema, type IngestBatch } from "@alfred/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createIngestRoutes } from "../routes/ingest";
import type { DeviceAuthStore } from "../auth/device-auth";
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

type InMemoryDeviceSeen = {
  workspaceId: string;
  deviceId: string;
  seenAt: Date;
};

type InMemoryEnsuredDevice = {
  workspaceId: string;
  deviceId: string;
  sentAt: string;
};

function runStatusForTest(event: IngestBatch["events"][number]) {
  if (event.type === "run.started") return "running";
  if (event.type === "run.completed") return "completed";
  if (event.type === "run.failed") return "failed";
  if (event.type === "agent.waiting") return "waiting";
  if (event.type === "tool.started") return "running";
  if (event.status && event.type.startsWith("run.")) return event.status;
  return null;
}

function runTimestampsForTest(event: IngestBatch["events"][number]) {
  const occurredAt = new Date(event.occurred_at);
  return {
    startedAt: event.type === "run.started" ? occurredAt : null,
    completedAt: isTerminalRunEventForTest(event) ? occurredAt : null,
  };
}

function isTerminalRunEventForTest(event: IngestBatch["events"][number]): boolean {
  if (event.type === "run.completed" || event.type === "run.failed") return true;
  return event.type.startsWith("run.") && event.status === "cancelled";
}

function makeInMemoryStore(): IngestStore & {
  getEnsuredDevice: () => InMemoryEnsuredDevice | undefined;
  getEnsuredWorkspace: () => string | undefined;
  getDeviceSeen: () => InMemoryDeviceSeen | undefined;
  getRun: (key: string) => InMemoryRun | undefined;
} {
  const batches = new Set<string>();
  const events = new Set<string>();
  const projects = new Map<string, { id: string }>();
  const runs = new Map<string, InMemoryRun>();
  const relations = new Set<string>();
  let ensuredWorkspace: string | undefined;
  let ensuredDevice: InMemoryEnsuredDevice | undefined;
  let deviceSeen: InMemoryDeviceSeen | undefined;

  const store: IngestStore & {
    getEnsuredDevice: () => InMemoryEnsuredDevice | undefined;
    getEnsuredWorkspace: () => string | undefined;
    getDeviceSeen: () => InMemoryDeviceSeen | undefined;
    getRun: (key: string) => InMemoryRun | undefined;
  } = {
    transaction: async (fn) => fn(store),
    insertBatchIfNew: async (batch) => {
      const key = `${batch.workspace_id}:${batch.batch_id}`;
      if (batches.has(key)) return false;
      batches.add(key);
      return true;
    },
    markBatchAccepted: async () => undefined,
    ensureWorkspace: async (seenWorkspaceId) => {
      ensuredWorkspace = seenWorkspaceId;
    },
    ensureDevice: async (device) => {
      ensuredDevice = {
        workspaceId: device.workspace_id,
        deviceId: device.device_id,
        sentAt: device.sent_at,
      };
    },
    markDeviceSeen: async (seenWorkspaceId, seenDeviceId, seenAt) => {
      deviceSeen = { workspaceId: seenWorkspaceId, deviceId: seenDeviceId, seenAt };
    },
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
        const nextStatus = runStatusForTest(event);
        existing.status = nextStatus ?? existing.status;
        existing.startedAt = timestamps.startedAt ?? existing.startedAt;
        existing.completedAt =
          nextStatus === "running" || nextStatus === "waiting"
            ? null
            : timestamps.completedAt ?? existing.completedAt;
        return existing;
      }
      const run = {
        id: `run-${runs.size + 1}`,
        status: runStatusForTest(event) ?? "unknown",
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
    getEnsuredDevice: () => ensuredDevice,
    getEnsuredWorkspace: () => ensuredWorkspace,
    getDeviceSeen: () => deviceSeen,
    getRun: (key) => runs.get(key),
  };
  return store;
}

function createDeviceAuthStore(): DeviceAuthStore {
  return {
    authenticateDeviceToken: async (token) =>
      token === "secret"
        ? {
            workspaceId,
            deviceId,
          }
        : null,
  };
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

  it("reopens an existing run when more activity arrives after a completed turn", async () => {
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
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000203", {
        source_event_id: "source-event-waiting",
        event_id: "event-000000000003",
        type: "agent.waiting",
        status: "waiting",
        occurred_at: "2026-01-01T10:06:00.000Z",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000204", {
        source_event_id: "source-event-tool",
        event_id: "event-000000000004",
        type: "tool.started",
        occurred_at: "2026-01-01T10:07:00.000Z",
      }),
    );

    const run = db.getRun(`${workspaceId}:codex-cli:run-1`);
    expect(run).toMatchObject({
      status: "running",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      completedAt: null,
    });
  });

  it("closes an existing run when a run update marks it cancelled", async () => {
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
        source_event_id: "source-event-cancelled",
        event_id: "event-000000000002",
        type: "run.updated",
        status: "cancelled",
        occurred_at: "2026-01-01T10:03:00.000Z",
      }),
    );

    const run = db.getRun(`${workspaceId}:codex-cli:run-1`);
    expect(run).toMatchObject({
      status: "cancelled",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      completedAt: new Date("2026-01-01T10:03:00.000Z"),
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
    app.route("/v1/ingest", createIngestRoutes(makeInMemoryStore(), createDeviceAuthStore()));

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

  it("accepts authenticated runner heartbeats", async () => {
    const store = makeInMemoryStore();
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(store, createDeviceAuthStore()));

    const unauthorized = await app.request("/v1/ingest/heartbeat", {
      method: "POST",
    });

    expect(unauthorized.status).toBe(401);

    const accepted = await app.request("/v1/ingest/heartbeat", {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
      },
    });

    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({ ok: true });
    expect(store.getEnsuredWorkspace()).toBe(workspaceId);
    expect(store.getEnsuredDevice()).toMatchObject({
      workspaceId,
      deviceId,
      sentAt: expect.any(String),
    });
    expect(store.getDeviceSeen()).toMatchObject({
      workspaceId,
      deviceId,
      seenAt: expect.any(Date),
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeInMemoryStore(), createDeviceAuthStore()));

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
    app.route("/v1/ingest", createIngestRoutes(makeInMemoryStore(), createDeviceAuthStore()));

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

  it("rejects a token-bound device posting another workspace", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeInMemoryStore(), createDeviceAuthStore()));
    const spoofedWorkspaceId = "00000000-0000-4000-8000-000000000999";

    const response = await app.request("/v1/ingest/batches", {
      method: "POST",
      body: JSON.stringify({
        ...makeBatch(),
        workspace_id: spoofedWorkspaceId,
        events: makeBatch().events.map((event) => ({
          ...event,
          workspace_id: spoofedWorkspaceId,
        })),
      }),
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "device_scope_mismatch" });
  });

  it("rejects a token-bound workspace posting another device", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeInMemoryStore(), createDeviceAuthStore()));
    const spoofedDeviceId = "00000000-0000-4000-8000-000000000999";

    const response = await app.request("/v1/ingest/batches", {
      method: "POST",
      body: JSON.stringify({
        ...makeBatch(),
        device_id: spoofedDeviceId,
        events: makeBatch().events.map((event) => ({
          ...event,
          device_id: spoofedDeviceId,
        })),
      }),
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "device_scope_mismatch" });
  });

  it("keeps an existing run status when a technical event has no status", async () => {
    const db = makeInMemoryStore();

    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000201", {
        source_event_id: "source-event-started",
        event_id: "event-000000000001",
        type: "run.started",
        status: "running",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000202", {
        source_event_id: "source-event-tool",
        event_id: "event-000000000002",
        type: "tool.completed",
        status: undefined,
      }),
    );

    const run = db.getRun(`${workspaceId}:codex-cli:run-1`);
    expect(run?.status).toBe("running");
  });
});
