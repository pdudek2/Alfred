import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";
import { IngestBatchSchema, type IngestEvent } from "@alfred/schema";

import { runRunnerLoop, runRunnerOnce } from "../index.js";
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

  it("drains all ready outbox batches after collecting a large import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alfred-runner-drain-"));
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const events: IngestEvent[] = Array.from({ length: 250 }, (_, index) => {
      const eventId = `event-${String(index).padStart(12, "0")}`;
      return {
        event_id: eventId,
        workspace_id: workspaceId,
        device_id: deviceId,
        project_key: "Alfred",
        source_id: "codex-cli",
        source_run_id: `run-${Math.floor(index / 10)}`,
        source_event_id: eventId,
        type: "tool.started",
        privacy_mode: "standard",
        occurred_at: new Date(Date.UTC(2026, 3, 28, 10, 0, index)).toISOString(),
        payload: { tool_name: "exec_command" },
      };
    });
    const outboxPath = join(dir, "outbox.sqlite");

    await expect(
      runRunnerOnce(
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
            collect: async () => events,
          },
        },
      ),
    ).resolves.toEqual({ collectedEvents: 250, flushedEvents: 250 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const outbox = new OutboxDb(outboxPath);
    expect(outbox.countQueued()).toBe(0);
    outbox.close();
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

  it("advances explicit Codex since with the stored source cursor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alfred-runner-codex-cursor-"));
    const codexHome = join(dir, ".codex");
    const sessionPath = join(codexHome, "sessions/2026/04/28/session.jsonl");
    const outboxPath = join(dir, "outbox.sqlite");
    mkdirSync(join(codexHome, "sessions/2026/04/28"), { recursive: true });
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({
          timestamp: "2026-04-28T10:00:00.000Z",
          type: "session.start",
          id: "codex-run-1",
          cwd: "/Users/patryk/Desktop/Alfred",
        }),
        JSON.stringify({
          timestamp: "2026-04-28T10:00:01.000Z",
          type: "tool.call",
          id: "tool-1",
          session_id: "codex-run-1",
          tool: "exec_command",
        }),
      ].join("\n"),
    );
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const config = {
      apiUrl: "http://127.0.0.1:4301",
      deviceToken: "token-1",
      workspaceId,
      deviceId,
      privacyMode: "standard" as const,
      outboxPath,
      codexHome,
      codexSince: "2026-04-28T09:00:00.000Z",
    };

    await expect(runRunnerOnce(config, { fetchImpl })).resolves.toEqual({
      collectedEvents: 2,
      flushedEvents: 2,
    });
    await expect(runRunnerOnce(config, { fetchImpl })).resolves.toEqual({
      collectedEvents: 0,
      flushedEvents: 0,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("collects multiple source adapters and stores independent cursors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alfred-runner-multi-source-"));
    const outboxPath = join(dir, "outbox.sqlite");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const codexEvent: IngestEvent = {
      event_id: "codex-event-000001",
      workspace_id: workspaceId,
      device_id: deviceId,
      project_key: "Alfred",
      source_id: "codex-cli",
      source_run_id: "codex-run-1",
      source_event_id: "codex-event-1",
      type: "run.started",
      status: "running",
      privacy_mode: "standard",
      occurred_at: "2026-04-28T10:00:00.000Z",
      payload: {},
    };
    const claudeEvent: IngestEvent = {
      event_id: "claude-event-00001",
      workspace_id: workspaceId,
      device_id: deviceId,
      project_key: "Alfred",
      source_id: "claude-code",
      source_run_id: "claude-run-1",
      source_event_id: "claude-event-1",
      type: "agent.waiting",
      status: "waiting",
      privacy_mode: "standard",
      occurred_at: "2026-04-28T10:03:00.000Z",
      payload: {},
    };

    await expect(
      runRunnerOnce(
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
          adapters: [
            {
              sourceId: "codex-cli",
              collect: async () => [codexEvent],
            },
            {
              sourceId: "claude-code",
              collect: async () => [claudeEvent],
            },
          ],
        },
      ),
    ).resolves.toEqual({ collectedEvents: 2, flushedEvents: 2 });

    const request = (fetchImpl as unknown as FetchMock).mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    const parsed = IngestBatchSchema.parse(body);
    expect(parsed.events.map((event) => event.source_id)).toEqual(["codex-cli", "claude-code"]);

    const outbox = new OutboxDb(outboxPath);
    expect(outbox.getSourceCursor("codex-cli")).toBe("2026-04-28T10:00:00.000Z");
    expect(outbox.getSourceCursor("claude-code")).toBe("2026-04-28T10:03:00.000Z");
    outbox.close();
  });

  it("keeps polling while the runner loop is active", async () => {
    const dir = mkdtempSync(join(tmpdir(), "alfred-runner-loop-"));
    const outboxPath = join(dir, "outbox.sqlite");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const collect = vi
      .fn<() => Promise<IngestEvent[]>>()
      .mockResolvedValueOnce([
        {
          event_id: "loop-event-000001",
          workspace_id: workspaceId,
          device_id: deviceId,
          project_key: "Alfred",
          source_id: "codex-cli",
          source_run_id: "codex-run-1",
          source_event_id: "codex-event-1",
          type: "run.started",
          status: "running",
          privacy_mode: "standard",
          occurred_at: "2026-04-28T10:00:00.000Z",
          payload: {},
        },
      ])
      .mockResolvedValueOnce([]);
    const sleep = vi.fn(async () => undefined);
    const onIteration = vi.fn();

    await runRunnerLoop(
      {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        privacyMode: "standard",
        outboxPath,
        codexHome: join(dir, ".codex"),
        pollMs: 1_500,
      },
      {
        fetchImpl,
        maxIterations: 2,
        onIteration,
        sleep,
        adapter: {
          sourceId: "codex-cli",
          collect,
        },
      },
    );

    expect(collect).toHaveBeenCalledTimes(2);
    expect(onIteration).toHaveBeenNthCalledWith(1, { collectedEvents: 1, flushedEvents: 1 });
    expect(onIteration).toHaveBeenNthCalledWith(2, { collectedEvents: 0, flushedEvents: 0 });
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(1_500);
  });
});
