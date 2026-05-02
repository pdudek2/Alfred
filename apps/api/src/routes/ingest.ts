import { createDb, type Database } from "@alfred/db";
import { IngestBatchSchema } from "@alfred/schema";
import { Hono } from "hono";

import {
  createStaticDeviceAuthStore,
  requireDeviceToken,
  type DeviceAuthStore,
  type DeviceAuthVariables,
} from "../auth/device-auth.js";
import { env } from "../env.js";
import { ingestBatch, markRunnerHeartbeat, type IngestStore } from "../services/ingest-service.js";

export function createIngestRoutes(
  db: Database | IngestStore = createDb(),
  deviceAuthStore: DeviceAuthStore = createStaticDeviceAuthStore(
    env.RUNNER_DEVICE_TOKEN,
    env.RUNNER_WORKSPACE_ID,
    env.RUNNER_DEVICE_ID,
  ),
) {
  const ingestRoutes = new Hono<{ Variables: DeviceAuthVariables }>();

  ingestRoutes.post("/batches", requireDeviceToken(deviceAuthStore), async (c) => {
    let body: unknown;

    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }

    const parsed = IngestBatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const batch = parsed.data;
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
