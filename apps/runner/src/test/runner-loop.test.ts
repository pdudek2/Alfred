import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import { OutboxDb } from "../outbox/outbox-db.js";
import { flushOutboxOnce } from "../outbox/outbox-worker.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000101";

function createOutbox() {
  const dir = mkdtempSync(join(tmpdir(), "alfred-outbox-worker-"));
  return new OutboxDb(join(dir, "outbox.sqlite"));
}

function enqueueValidEvent(outbox: OutboxDb, eventId = "123456789012") {
  outbox.enqueue({
    event_id: eventId,
    workspace_id: workspaceId,
    device_id: deviceId,
    project_key: "Alfred",
    source_id: "codex-cli",
    source_run_id: "run-1",
    source_event_id: eventId,
    type: "run.started",
    privacy_mode: "standard",
    occurred_at: "2026-04-28T10:00:00.000Z",
    payload: {},
  });
}

describe("flushOutboxOnce", () => {
  it("sends ready events and removes them after success", async () => {
    const outbox = createOutbox();
    enqueueValidEvent(outbox);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

    await expect(
      flushOutboxOnce(outbox, {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        fetchImpl,
        now: new Date("2026-04-28T10:00:00.000Z"),
      }),
    ).resolves.toBe(1);

    expect(outbox.listReady(10)).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    outbox.close();
  });

  it("keeps failed events and schedules retry", async () => {
    const outbox = createOutbox();
    enqueueValidEvent(outbox);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));

    await expect(
      flushOutboxOnce(outbox, {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        fetchImpl,
        now: new Date("2026-04-28T10:00:00.000Z"),
      }),
    ).rejects.toThrow(/Ingest failed/);

    expect(outbox.listReady(10, new Date("2026-04-28T10:00:00.500Z"))).toHaveLength(0);
    const [failed] = outbox.listReady(10, new Date("2026-04-28T10:00:01.000Z"));
    expect(failed?.attempts).toBe(1);
    outbox.close();
  });

  it("does not send requests for an empty outbox", async () => {
    const outbox = createOutbox();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

    await expect(
      flushOutboxOnce(outbox, {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        fetchImpl,
      }),
    ).resolves.toBe(0);

    expect(fetchImpl).not.toHaveBeenCalled();
    outbox.close();
  });
});
