import { randomUUID } from "node:crypto";

import {
  IngestBatchSchema,
  IngestEventSchema,
  type IngestBatch,
  type IngestEvent,
} from "@alfred/schema";

import type {
  OutboxDb,
  OutboxQuarantineReason,
  OutboxRecord,
} from "./outbox-db.js";
import {
  IngestRequestError,
  postIngestBatch,
  type IngestClientConfig,
} from "../sync/ingest-client.js";

export type FlushOutboxConfig = IngestClientConfig & {
  workspaceId: string;
  deviceId: string;
  limit?: number;
  now?: Date;
  onWarning?: (message: string) => void;
};

export type FlushOutboxResult = {
  sent: number;
  quarantined: number;
};

export async function flushOutboxOnce(
  outbox: OutboxDb,
  config: FlushOutboxConfig,
): Promise<FlushOutboxResult> {
  const now = config.now ?? new Date();
  const records = outbox.listReady(config.limit ?? 100, now);

  if (records.length === 0) {
    return { sent: 0, quarantined: 0 };
  }

  const validRecords: Array<{ record: OutboxRecord; event: IngestEvent }> = [];
  let quarantined = 0;

  for (const record of records) {
    const parsed = IngestEventSchema.safeParse(record.payload);
    if (!parsed.success) {
      quarantine(outbox, record, "invalid_payload", config, now);
      quarantined += 1;
      continue;
    }
    if (
      parsed.data.workspace_id !== config.workspaceId ||
      parsed.data.device_id !== config.deviceId
    ) {
      quarantine(outbox, record, "identity_mismatch", config, now);
      quarantined += 1;
      continue;
    }

    validRecords.push({ record, event: parsed.data });
  }

  if (validRecords.length === 0) {
    return { sent: 0, quarantined };
  }

  try {
    await postIngestBatch(
      config,
      createBatch(
        config,
        validRecords.map(({ event }) => event),
        now,
      ),
    );
    outbox.markSent(validRecords.map(({ record }) => record.id));
    return { sent: validRecords.length, quarantined };
  } catch (error) {
    if (isPermanentEventRejection(error) && validRecords.length === 1) {
      quarantine(
        outbox,
        validRecords[0]!.record,
        "permanent_ingest_rejection",
        config,
        now,
      );
      return { sent: 0, quarantined: quarantined + 1 };
    }

    if (isPermanentEventRejection(error)) {
      let sent = 0;
      let retryableError: unknown;

      for (const { record, event } of validRecords) {
        try {
          await postIngestBatch(config, createBatch(config, [event], now));
          outbox.markSent([record.id]);
          sent += 1;
        } catch (singletonError) {
          if (isPermanentEventRejection(singletonError)) {
            quarantine(outbox, record, "permanent_ingest_rejection", config, now);
            quarantined += 1;
          } else {
            outbox.markFailed(record.id, nextRetryAt(record, now));
            retryableError ??= singletonError;
          }
        }
      }

      if (retryableError !== undefined) throw retryableError;
      return { sent, quarantined };
    }

    for (const { record } of validRecords) {
      outbox.markFailed(record.id, nextRetryAt(record, now));
    }

    throw error;
  }
}

function createBatch(
  config: Pick<FlushOutboxConfig, "workspaceId" | "deviceId">,
  events: IngestEvent[],
  now: Date,
): IngestBatch {
  return IngestBatchSchema.parse({
    batch_id: randomUUID(),
    workspace_id: config.workspaceId,
    device_id: config.deviceId,
    sent_at: now.toISOString(),
    events,
  });
}

function quarantine(
  outbox: OutboxDb,
  record: OutboxRecord,
  reason: OutboxQuarantineReason,
  config: FlushOutboxConfig,
  now: Date,
): void {
  outbox.quarantine(record.id, reason, now);
  config.onWarning?.(`Quarantined event ${record.eventId}: ${reason}`);
}

function isPermanentEventRejection(error: unknown): boolean {
  return (
    error instanceof IngestRequestError &&
    (error.status === 400 || error.status === 413 || error.status === 422)
  );
}

function nextRetryAt(record: OutboxRecord, now: Date): Date {
  const delayMs = Math.min(60_000, 2 ** record.attempts * 1_000);
  return new Date(now.getTime() + delayMs);
}
