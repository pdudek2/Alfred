import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createIngestRoutes } from "../routes/ingest";
import type { DeviceAuthStore } from "../auth/device-auth";
import type { IngestStore } from "../services/ingest-service";
import { deviceId, makeBatch, workspaceId } from "./support/ingest-fixtures";

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

function makeRouteStore(): IngestStore & {
  getEnsuredDevice: () => InMemoryEnsuredDevice | undefined;
  getDeviceSeen: () => InMemoryDeviceSeen | undefined;
} {
  let ensuredDevice: InMemoryEnsuredDevice | undefined;
  let deviceSeen: InMemoryDeviceSeen | undefined;

  const store: IngestStore & {
    getEnsuredDevice: () => InMemoryEnsuredDevice | undefined;
    getDeviceSeen: () => InMemoryDeviceSeen | undefined;
  } = {
    transaction: async (fn) => fn(store),
    insertBatchIfNew: async () => true,
    markBatchAccepted: async () => undefined,
    ensureDevice: async (device) => {
      ensuredDevice = {
        workspaceId: device.workspace_id,
        deviceId: device.device_id,
        sentAt: device.sent_at,
      };
    },
    markDeviceSeen: async (seenWorkspaceId, seenDeviceId, seenAt) => {
      deviceSeen = {
        workspaceId: seenWorkspaceId,
        deviceId: seenDeviceId,
        seenAt,
      };
    },
    eventExists: async () => false,
    upsertProject: async () => ({ id: "fixture-project" }),
    upsertRun: async () => ({ id: "fixture-run" }),
    upsertRelation: async () => undefined,
    insertEvent: async () => true,
    getEnsuredDevice: () => ensuredDevice,
    getDeviceSeen: () => deviceSeen,
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
  it("mounts POST /v1/ingest/batches and requires a device token", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeRouteStore(), createDeviceAuthStore()));

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
    const store = makeRouteStore();
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
    app.route("/v1/ingest", createIngestRoutes(makeRouteStore(), createDeviceAuthStore()));

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

  it("returns 413 before parsing oversized ingest batches", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeRouteStore(), createDeviceAuthStore()));

    const response = await app.request("/v1/ingest/batches", {
      method: "POST",
      body: "{",
      headers: {
        authorization: "Bearer secret",
        "content-length": String(5 * 1024 * 1024 + 1),
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "batch_too_large" });
  });

  it("returns 413 for oversized event payloads", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeRouteStore(), createDeviceAuthStore()));
    const batch = makeBatch("00000000-0000-4000-8000-000000000301", {
      payload: { text: "x".repeat(256 * 1024 + 1) },
    });

    const response = await app.request("/v1/ingest/batches", {
      method: "POST",
      body: JSON.stringify(batch),
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "event_payload_too_large", event_index: 0 });
  });

  it("returns 400 for schema-invalid JSON", async () => {
    const app = new Hono();
    app.route("/v1/ingest", createIngestRoutes(makeRouteStore(), createDeviceAuthStore()));

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
    app.route("/v1/ingest", createIngestRoutes(makeRouteStore(), createDeviceAuthStore()));
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
    app.route("/v1/ingest", createIngestRoutes(makeRouteStore(), createDeviceAuthStore()));
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

});
