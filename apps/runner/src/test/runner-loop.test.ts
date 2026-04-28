import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";
import { IngestBatchSchema, type IngestEvent } from "@alfred/schema";

import { runRunnerOnce } from "../index.js";
import { OutboxDb } from "../outbox/outbox-db.js";
import { flushOutboxOnce } from "../outbox/outbox-worker.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000101";
type FetchMock = { mock: { calls: Array<[string, RequestInit]> } };

function createOutbox() {
  const dir = mkdtempSync(join(tmpdir(), "alfred-outbox-worker-"));
  return new OutboxDb(join(dir, "outbox.sqlite"));
}

function enqueueValidEvent(outbox: OutboxDb, eventId = "123456789012") {
  outbox.enqueue(
    {
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
    },
    new Date("2026-04-28T10:00:00.000Z"),
  );
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
    const request = (fetchImpl as unknown as FetchMock).mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    expect(IngestBatchSchema.safeParse(body).success).toBe(true);
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

  it("collects adapter events, redacts payload, and flushes a valid batch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alfred-runner-main-"));
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const event: IngestEvent = {
      event_id: "123456789012",
      workspace_id: workspaceId,
      device_id: deviceId,
      project_key: "Alfred",
      source_id: "codex-cli",
      source_run_id: "run-1",
      source_event_id: "event-1",
      type: "run.started",
      status: "running",
      privacy_mode: "standard",
      occurred_at: "2026-04-28T10:00:00.000Z",
      payload: { api_key: "secret", summary: "started" },
    };

    await expect(
      runRunnerOnce(
        {
          apiUrl: "http://127.0.0.1:4301",
          deviceToken: "token-1",
          workspaceId,
          deviceId,
          privacyMode: "standard",
          outboxPath: join(dir, "outbox.sqlite"),
          codexHome: join(dir, ".codex"),
        },
        {
          fetchImpl,
          adapter: {
            sourceId: "codex-cli",
            collect: async () => [event],
          },
        },
      ),
    ).resolves.toEqual({ collectedEvents: 1, flushedEvents: 1 });

    const request = (fetchImpl as unknown as FetchMock).mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    const parsed = IngestBatchSchema.parse(body);
    expect(parsed.events[0]?.payload).toMatchObject({ api_key: "[redacted]", summary: "started" });
  });

  it("stores the newest collected event timestamp as the source cursor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alfred-runner-cursor-"));
    const outboxPath = join(dir, "outbox.sqlite");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const firstEvent: IngestEvent = {
      event_id: "123456789012",
      workspace_id: workspaceId,
      device_id: deviceId,
      project_key: "Alfred",
      source_id: "codex-cli",
      source_run_id: "run-1",
      source_event_id: "event-1",
      type: "run.started",
      status: "running",
      privacy_mode: "standard",
      occurred_at: "2026-04-28T10:00:00.000Z",
      payload: {},
    };
    const secondEvent: IngestEvent = {
      ...firstEvent,
      event_id: "123456789013",
      source_event_id: "event-2",
      type: "tool.completed",
      status: "completed",
      occurred_at: "2026-04-28T10:05:00.000Z",
    };

    await runRunnerOnce(
      {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        privacyMode: "standard",
        outboxPath,
        codexHome: join(dir, ".codex"),
      },
      {
        fetchImpl,
        adapter: {
          sourceId: "codex-cli",
          collect: async () => [secondEvent, firstEvent],
        },
      },
    );

    const outbox = new OutboxDb(outboxPath);
    expect(outbox.getSourceCursor("codex-cli")).toBe("2026-04-28T10:05:00.000Z");
    outbox.close();
  });
});
