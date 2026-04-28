import { createDb, type Database } from "@alfred/db";
import { IngestBatchSchema } from "@alfred/schema";
import { Hono } from "hono";

import { requireDeviceToken } from "../auth/device-auth";
import { env } from "../env";
import { ingestBatch, type IngestStore } from "../services/ingest-service";

export function createIngestRoutes(
  db: Database | IngestStore = createDb(),
  runnerDeviceToken = env.RUNNER_DEVICE_TOKEN,
) {
  const ingestRoutes = new Hono();

  ingestRoutes.post("/batches", requireDeviceToken(runnerDeviceToken), async (c) => {
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
    const result = await ingestBatch(db, batch);
    return c.json(result, 202);
  });

  return ingestRoutes;
}
