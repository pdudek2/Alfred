import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { OutboxDb } from "../outbox/outbox-db.js";

function createOutbox() {
  const dir = mkdtempSync(join(tmpdir(), "alfred-outbox-"));
  return new OutboxDb(join(dir, "outbox.sqlite"));
}

describe("OutboxDb", () => {
  it("enqueues and lists ready events", () => {
    const outbox = createOutbox();

    outbox.enqueue({ event_id: "event-1", type: "run.started" });

    const records = outbox.listReady(10);
    expect(records).toHaveLength(1);
    expect(records[0]?.eventId).toBe("event-1");
    expect(records[0]?.payload).toMatchObject({ event_id: "event-1" });

    outbox.close();
  });

  it("deduplicates by event id", () => {
    const outbox = createOutbox();

    outbox.enqueue({ event_id: "event-1", type: "run.started" });
    outbox.enqueue({ event_id: "event-1", type: "run.started" });

    expect(outbox.listReady(10)).toHaveLength(1);

    outbox.close();
  });

  it("removes sent records", () => {
    const outbox = createOutbox();

    outbox.enqueue({ event_id: "event-1", type: "run.started" });
    const [record] = outbox.listReady(10);
    expect(record).toBeDefined();

    outbox.markSent([record!.id]);

    expect(outbox.listReady(10)).toHaveLength(0);
    outbox.close();
  });

  it("marks failed records with retry time", () => {
    const outbox = createOutbox();
    const retryAt = new Date("2026-04-28T10:00:00.000Z");

    outbox.enqueue({ event_id: "event-1", type: "run.started" });
    const [record] = outbox.listReady(10);
    expect(record).toBeDefined();

    outbox.markFailed(record!.id, retryAt);

    const [failed] = outbox.listReady(10, new Date("2026-04-28T10:00:01.000Z"));
    expect(failed?.attempts).toBe(1);
    expect(failed?.nextAttemptAt).toBe("2026-04-28T10:00:00.000Z");

    outbox.close();
  });
});
