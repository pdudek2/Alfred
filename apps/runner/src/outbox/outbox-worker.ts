import { randomUUID } from "node:crypto";

import { IngestBatchSchema, IngestEventSchema, type IngestEvent } from "@alfred/schema";

import type { OutboxDb, OutboxRecord } from "./outbox-db.js";
import { postIngestBatch, type IngestClientConfig } from "../sync/ingest-client.js";

export type FlushOutboxConfig = IngestClientConfig & {
  workspaceId: string;
  deviceId: string;
  limit?: number;
  now?: Date;
};

export async function flushOutboxOnce(outbox: OutboxDb, config: FlushOutboxConfig): Promise<number> {
  const now = config.now ?? new Date();
  const records = outbox.listReady(config.limit ?? 100, now);

  if (records.length === 0) {
    return 0;
  }

  const validRecords: Array<{ record: OutboxRecord; event: IngestEvent }> = [];

  for (const record of records) {
    const parsed = IngestEventSchema.safeParse(record.payload);
    if (!parsed.success || parsed.data.workspace_id !== config.workspaceId || parsed.data.device_id !== config.deviceId) {
      outbox.markSent([record.id]);
      continue;
    }

    validRecords.push({ record, event: parsed.data });
  }

  if (validRecords.length === 0) {
    return 0;
  }

  const batch = IngestBatchSchema.parse({
    batch_id: randomUUID(),
    workspace_id: config.workspaceId,
    device_id: config.deviceId,
    sent_at: now.toISOString(),
    events: validRecords.map(({ event }) => event),
  });

  try {
    await postIngestBatch(config, batch);
    outbox.markSent(validRecords.map(({ record }) => record.id));
    return validRecords.length;
  } catch (error) {
    for (const { record } of validRecords) {
      outbox.markFailed(record.id, nextRetryAt(record, now));
    }

    throw error;
  }
}

function nextRetryAt(record: OutboxRecord, now: Date): Date {
  const delayMs = Math.min(60_000, 2 ** record.attempts * 1_000);
  return new Date(now.getTime() + delayMs);
}
