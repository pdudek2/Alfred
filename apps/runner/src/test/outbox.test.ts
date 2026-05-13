import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { OutboxDb } from "../outbox/outbox-db.js";

const tempDirs: string[] = [];

function createOutbox() {
  const dir = trackedTempDir("alfred-outbox-");
  return new OutboxDb(join(dir, "outbox.sqlite"));
}

describe("OutboxDb", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

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

  it("counts all queued records including delayed failed records", () => {
    const outbox = createOutbox();

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

  it("stores one cursor per source", () => {
    const outbox = createOutbox();

    expect(outbox.getSourceCursor("codex-cli")).toBeNull();

    outbox.setSourceCursor("codex-cli", "2026-04-28T10:00:00.000Z");
    outbox.setSourceCursor("claude-code", "2026-04-28T11:00:00.000Z");
    outbox.setSourceCursor("codex-cli", "2026-04-28T12:00:00.000Z");

    expect(outbox.getSourceCursor("codex-cli")).toBe("2026-04-28T12:00:00.000Z");
    expect(outbox.getSourceCursor("claude-code")).toBe("2026-04-28T11:00:00.000Z");

    outbox.close();
  });

  it("prunes only failed records whose retry time is before the cutoff", () => {
    const outbox = createOutbox();

    outbox.enqueue(
      { event_id: "old-failed", type: "run.started" },
      new Date("2026-04-28T09:00:00.000Z"),
    );
    outbox.enqueue(
      { event_id: "old-queued", type: "run.started" },
      new Date("2026-04-28T09:05:00.000Z"),
    );
    outbox.enqueue(
      { event_id: "recent-failed", type: "run.started" },
      new Date("2026-04-28T10:00:00.000Z"),
    );

    const records = outbox.listReady(10, new Date("2026-04-28T10:00:00.000Z"));
    const oldFailed = records.find((record) => record.eventId === "old-failed");
    const recentFailed = records.find((record) => record.eventId === "recent-failed");
    expect(oldFailed).toBeDefined();
    expect(recentFailed).toBeDefined();

    outbox.markFailed(oldFailed!.id, new Date("2026-04-28T10:30:00.000Z"));
    outbox.markFailed(recentFailed!.id, new Date("2026-04-28T11:30:00.000Z"));

    expect(outbox.pruneFailedBefore(new Date("2026-04-28T11:00:00.000Z"))).toBe(1);
    expect(outbox.countQueued()).toBe(2);
    expect(
      outbox.listReady(10, new Date("2026-04-28T12:00:00.000Z")).map((record) => record.eventId),
    ).toEqual(["old-queued", "recent-failed"]);

    outbox.close();
  });
});

function trackedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
