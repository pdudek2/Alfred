import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { OutboxDb } from "../outbox/outbox-db.js";
import { sourceCursorKey } from "../sources/source-cursor.js";

const tempDirs: string[] = [];

function createOutbox() {
  const dir = trackedTempDir("alfred-outbox-");
  const path = join(dir, "outbox.sqlite");
  return { outbox: new OutboxDb(path), path };
}

describe("OutboxDb", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("enqueues and lists ready events", () => {
    const { outbox } = createOutbox();

    outbox.enqueue({ event_id: "event-1", type: "run.started" });

    const records = outbox.listReady(10);
    expect(records).toHaveLength(1);
    expect(records[0]?.eventId).toBe("event-1");
    expect(records[0]?.payload).toMatchObject({ event_id: "event-1" });

    outbox.close();
  });

  it("deduplicates by event id", () => {
    const { outbox } = createOutbox();

    outbox.enqueue({ event_id: "event-1", type: "run.started" });
    outbox.enqueue({ event_id: "event-1", type: "run.started" });

    expect(outbox.listReady(10)).toHaveLength(1);

    outbox.close();
  });

  it("removes sent records", () => {
    const { outbox } = createOutbox();

    outbox.enqueue({ event_id: "event-1", type: "run.started" });
    const [record] = outbox.listReady(10);
    expect(record).toBeDefined();

    outbox.markSent([record!.id]);

    expect(outbox.listReady(10)).toHaveLength(0);
    outbox.close();
  });

  it("marks failed records with retry time", () => {
    const { outbox } = createOutbox();
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

  it("counts all queued records including delayed failed records", () => {
    const { outbox } = createOutbox();

    outbox.enqueue(
      { event_id: "event-1", type: "run.started" },
      new Date("2026-04-28T09:00:00.000Z"),
    );
    outbox.enqueue(
      { event_id: "event-2", type: "run.started" },
      new Date("2026-04-28T09:01:00.000Z"),
    );
    const [record] = outbox.listReady(10, new Date("2026-04-28T09:01:00.000Z"));
    expect(record).toBeDefined();

    outbox.markFailed(record!.id, new Date("2026-04-28T10:00:00.000Z"));

    expect(outbox.countQueued()).toBe(2);
    outbox.close();
  });

  it("stores independent cursors for session files from the same source", () => {
    const { outbox } = createOutbox();
    const first = sourceCursorKey("codex-cli", "sessions/a.jsonl");
    const second = sourceCursorKey("codex-cli", "sessions/b.jsonl");

    outbox.setSourceCursor(first, "2026-04-28T10:00:00.000Z");
    outbox.setSourceCursor(second, "2026-04-28T09:00:00.000Z");

    expect(outbox.getSourceCursor(first)).toBe("2026-04-28T10:00:00.000Z");
    expect(outbox.getSourceCursor(second)).toBe("2026-04-28T09:00:00.000Z");
    expect(first).not.toBe(second);

    outbox.close();
  });

  it("quarantines rejected records durably and prevents re-enqueue", () => {
    const { outbox, path } = createOutbox();
    const event = { event_id: "event-1", type: "run.started" };

    outbox.enqueue(event);
    const [record] = outbox.listReady(10);
    expect(record).toBeDefined();

    outbox.quarantine(
      record!.id,
      "invalid_payload",
      new Date("2026-04-28T11:00:00.000Z"),
    );
    outbox.enqueue(event);
    expect(outbox.countQueued()).toBe(0);
    outbox.close();

    const db = new Database(path);
    const deadLetter = db
      .prepare(`
        SELECT event_id, payload, attempts, reason, created_at, quarantined_at
        FROM outbox_dead_letters
      `)
      .get() as {
      event_id: string;
      payload: string;
      attempts: number;
      reason: string;
      created_at: string;
      quarantined_at: string;
    };

    expect(deadLetter).toMatchObject({
      event_id: "event-1",
      reason: "invalid_payload",
      attempts: 0,
      quarantined_at: "2026-04-28T11:00:00.000Z",
    });
    expect(JSON.parse(deadLetter.payload)).toEqual(event);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM outbox_dead_letters").get(),
    ).toMatchObject({ count: 1 });
    db.close();
  });
});

function trackedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
