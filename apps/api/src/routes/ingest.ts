import { type Database } from "@alfred/db";
import { IngestBatchSchema } from "@alfred/schema";
import { Hono } from "hono";

import { requireDeviceToken, type DeviceAuthStore, type DeviceAuthVariables } from "../auth/device-auth.js";
import { ingestBatch, markRunnerHeartbeat, type IngestStore } from "../services/ingest-service.js";

const MAX_BATCH_BODY_BYTES = 5 * 1024 * 1024;
const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;

export function createIngestRoutes(db: Database | IngestStore, deviceAuthStore: DeviceAuthStore) {
  const ingestRoutes = new Hono<{ Variables: DeviceAuthVariables }>();

  ingestRoutes.post("/batches", requireDeviceToken(deviceAuthStore), async (c) => {
    let body: unknown;
    const contentLength = parseContentLength(c.req.header("content-length"));
    if (contentLength !== null && contentLength > MAX_BATCH_BODY_BYTES) {
      return c.json({ error: "batch_too_large" }, 413);
    }

    try {
      const rawBody = await c.req.text();
      if (byteLength(rawBody) > MAX_BATCH_BODY_BYTES) {
        return c.json({ error: "batch_too_large" }, 413);
      }
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }

    const parsed = IngestBatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const batch = parsed.data;
    const oversizedPayloadIndex = batch.events.findIndex((event) => byteLength(JSON.stringify(event.payload)) > MAX_EVENT_PAYLOAD_BYTES);
    if (oversizedPayloadIndex >= 0) {
      return c.json({ error: "event_payload_too_large", event_index: oversizedPayloadIndex }, 413);
    }

    const deviceAuth = c.get("deviceAuth");
    if (batch.workspace_id !== deviceAuth.workspaceId || batch.device_id !== deviceAuth.deviceId) {
      return c.json({ error: "device_scope_mismatch" }, 403);
    }

    const result = await ingestBatch(db, batch);
    return c.json(result, 202);
  });

  ingestRoutes.post("/heartbeat", requireDeviceToken(deviceAuthStore), async (c) => {
    const deviceAuth = c.get("deviceAuth");
    const result = await markRunnerHeartbeat(db, {
      workspaceId: deviceAuth.workspaceId,
      deviceId: deviceAuth.deviceId,
    });

    return c.json(result, 202);
  });

  return ingestRoutes;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function parseContentLength(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
