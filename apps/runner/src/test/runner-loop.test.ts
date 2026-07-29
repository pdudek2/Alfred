import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IngestBatchSchema, type IngestEvent } from "@alfred/schema";

import { runRunnerLoop, runRunnerOnce } from "../index.js";
import { OutboxDb } from "../outbox/outbox-db.js";
import { flushOutboxOnce } from "../outbox/outbox-worker.js";
import type { SourceCollection } from "../sources/source-adapter.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000101";
const tempDirs: string[] = [];
type FetchMock = { mock: { calls: Array<[string, RequestInit]> } };

function createOutbox() {
  const dir = trackedTempDir("alfred-outbox-worker-");
  return new OutboxDb(join(dir, "outbox.sqlite"));
}

function enqueueValidEvent(
  outbox: OutboxDb,
  eventId = "123456789012",
  overrides: Partial<IngestEvent> = {},
  now = new Date("2026-04-28T10:00:00.000Z"),
) {
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
      ...overrides,
    },
    now,
  );
}

function readDeadLetters(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    return db
      .prepare("SELECT event_id, payload, reason FROM outbox_dead_letters ORDER BY id")
      .all() as Array<{ event_id: string; payload: string; reason: string }>;
  } finally {
    db.close();
  }
}

describe("flushOutboxOnce", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

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
    ).resolves.toEqual({ sent: 1, quarantined: 0 });

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

  it("quarantines invalid and identity-mismatched records while sending valid records", async () => {
    const dir = trackedTempDir("alfred-outbox-local-quarantine-");
    const outboxPath = join(dir, "outbox.sqlite");
    const outbox = new OutboxDb(outboxPath);
    outbox.enqueue(
      {
        event_id: "invalid-event-1",
        type: "run.started",
        payload: { secret: "invalid-secret-payload" },
      },
      new Date("2026-04-28T10:00:00.000Z"),
    );
    enqueueValidEvent(outbox, "wrong-workspace-01", {
      workspace_id: "00000000-0000-4000-8000-000000000002",
      payload: { secret: "identity-secret-payload" },
    });
    enqueueValidEvent(outbox, "valid-event-000001");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const warnings: string[] = [];

    await expect(
      flushOutboxOnce(outbox, {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        fetchImpl,
        onWarning: (message) => warnings.push(message),
        now: new Date("2026-04-28T10:00:00.000Z"),
      }),
    ).resolves.toEqual({ sent: 1, quarantined: 2 });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = (fetchImpl as unknown as FetchMock).mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    const parsed = IngestBatchSchema.parse(body);
    expect(parsed.events.map((event) => event.event_id)).toEqual(["valid-event-000001"]);
    expect(outbox.countQueued()).toBe(0);
    expect(warnings).toEqual([
      "Quarantined event invalid-event-1: invalid_payload",
      "Quarantined event wrong-workspace-01: identity_mismatch",
    ]);
    expect(warnings.join(" ")).not.toContain("secret-payload");
    outbox.close();

    const deadLetters = readDeadLetters(outboxPath);
    expect(deadLetters.map(({ event_id, reason }) => ({ event_id, reason }))).toEqual([
      { event_id: "invalid-event-1", reason: "invalid_payload" },
      { event_id: "wrong-workspace-01", reason: "identity_mismatch" },
    ]);
    expect(JSON.parse(deadLetters[0]!.payload)).toMatchObject({
      event_id: "invalid-event-1",
      payload: { secret: "invalid-secret-payload" },
    });
    expect(JSON.parse(deadLetters[1]!.payload)).toMatchObject({
      event_id: "wrong-workspace-01",
      payload: { secret: "identity-secret-payload" },
    });
  });

  it("isolates a permanently rejected event and sends healthy singletons", async () => {
    const dir = trackedTempDir("alfred-outbox-permanent-rejection-");
    const outboxPath = join(dir, "outbox.sqlite");
    const outbox = new OutboxDb(outboxPath);
    enqueueValidEvent(outbox, "healthy-event-0001");
    enqueueValidEvent(outbox, "poison-event-00001", {
      payload: { secret: "poison-secret-payload" },
    });
    enqueueValidEvent(outbox, "healthy-event-0002");
    const warnings: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const request = IngestBatchSchema.parse(body);
      if (request.events.length > 1) return new Response("{}", { status: 400 });
      return new Response("{}", {
        status: request.events[0]?.event_id === "poison-event-00001" ? 400 : 202,
      });
    });

    await expect(
      flushOutboxOnce(outbox, {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        fetchImpl,
        onWarning: (message) => warnings.push(message),
        now: new Date("2026-04-28T10:00:00.000Z"),
      }),
    ).resolves.toEqual({ sent: 2, quarantined: 1 });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(outbox.countQueued()).toBe(0);
    expect(warnings).toEqual([
      "Quarantined event poison-event-00001: permanent_ingest_rejection",
    ]);
    expect(warnings[0]).not.toContain("poison-secret-payload");
    outbox.close();

    const [deadLetter] = readDeadLetters(outboxPath);
    expect(deadLetter).toMatchObject({
      event_id: "poison-event-00001",
      reason: "permanent_ingest_rejection",
    });
    expect(JSON.parse(deadLetter!.payload)).toMatchObject({
      event_id: "poison-event-00001",
      payload: { secret: "poison-secret-payload" },
    });
  });

  it("quarantines an event rejected by a singleton batch", async () => {
    const outbox = createOutbox();
    enqueueValidEvent(outbox, "poison-event-00001");
    const warnings: string[] = [];
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));

    await expect(
      flushOutboxOnce(outbox, {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        fetchImpl,
        onWarning: (message) => warnings.push(message),
        now: new Date("2026-04-28T10:00:00.000Z"),
      }),
    ).resolves.toEqual({ sent: 0, quarantined: 1 });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(outbox.countQueued()).toBe(0);
    expect(warnings).toEqual([
      "Quarantined event poison-event-00001: permanent_ingest_rejection",
    ]);
    outbox.close();
  });

  it("retains retryable singletons after a permanently rejected batch", async () => {
    const dir = trackedTempDir("alfred-outbox-transient-singleton-");
    const outboxPath = join(dir, "outbox.sqlite");
    const outbox = new OutboxDb(outboxPath);
    enqueueValidEvent(outbox, "healthy-event-0001");
    enqueueValidEvent(outbox, "poison-event-00001");
    enqueueValidEvent(outbox, "transient-event-001");
    const warnings: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const request = IngestBatchSchema.parse(body);
      if (request.events.length > 1) return new Response("{}", { status: 422 });

      const eventId = request.events[0]?.event_id;
      if (eventId === "poison-event-00001") return new Response("{}", { status: 413 });
      if (eventId === "transient-event-001") return new Response("{}", { status: 500 });
      return new Response("{}", { status: 202 });
    });

    await expect(
      flushOutboxOnce(outbox, {
        apiUrl: "http://127.0.0.1:4301",
        deviceToken: "token-1",
        workspaceId,
        deviceId,
        fetchImpl,
        onWarning: (message) => warnings.push(message),
        now: new Date("2026-04-28T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      name: "IngestRequestError",
      status: 500,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(warnings).toEqual([
      "Quarantined event poison-event-00001: permanent_ingest_rejection",
    ]);
    expect(outbox.countQueued()).toBe(1);
    const [retryable] = outbox.listReady(10, new Date("2026-04-28T10:00:01.000Z"));
    expect(retryable).toMatchObject({
      eventId: "transient-event-001",
      attempts: 1,
    });
    outbox.close();

    expect(readDeadLetters(outboxPath)).toEqual([
      expect.objectContaining({
        event_id: "poison-event-00001",
        reason: "permanent_ingest_rejection",
      }),
    ]);
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
    ).resolves.toEqual({ sent: 0, quarantined: 0 });

    expect(fetchImpl).not.toHaveBeenCalled();
    outbox.close();
  });

  it("collects adapter events, redacts payload, and flushes a valid batch", async () => {
    const dir = trackedTempDir("alfred-runner-main-");
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
            collect: async () => ({ events: [event], cursorUpdates: [] }),
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
    const dir = trackedTempDir("alfred-runner-drain-");
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
            collect: async () => ({ events, cursorUpdates: [] }),
          },
        },
      ),
    ).resolves.toEqual({ collectedEvents: 250, flushedEvents: 250 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const outbox = new OutboxDb(outboxPath);
    expect(outbox.countQueued()).toBe(0);
    outbox.close();
  });

  it("continues flushing after a page contains only quarantined records", async () => {
    const dir = trackedTempDir("alfred-runner-quarantine-drain-");
    const outboxPath = join(dir, "outbox.sqlite");
    const outbox = new OutboxDb(outboxPath);
    for (let index = 0; index < 100; index += 1) {
      outbox.enqueue(
        {
          event_id: `invalid-${String(index).padStart(12, "0")}`,
          type: "run.started",
        },
        new Date("2026-04-28T10:00:00.000Z"),
      );
    }
    enqueueValidEvent(
      outbox,
      "valid-after-invalid",
      {},
      new Date("2026-04-28T10:01:00.000Z"),
    );
    outbox.close();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

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
            collect: async () => ({ events: [], cursorUpdates: [] }),
          },
        },
      ),
    ).resolves.toEqual({ collectedEvents: 0, flushedEvents: 1 });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = (fetchImpl as unknown as FetchMock).mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    expect(IngestBatchSchema.parse(body).events.map((event) => event.event_id)).toEqual([
      "valid-after-invalid",
    ]);
  });

  it("routes payload-free quarantine warnings through runRunnerOnce", async () => {
    const dir = trackedTempDir("alfred-runner-quarantine-warning-");
    const outboxPath = join(dir, "outbox.sqlite");
    const outbox = new OutboxDb(outboxPath);
    outbox.enqueue(
      {
        event_id: "runner-invalid-0001",
        type: "run.started",
        payload: { secret: "runner-secret-payload" },
      },
      new Date("2026-04-28T10:00:00.000Z"),
    );
    outbox.close();
    const warnings: string[] = [];
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

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
        onWarning: (message) => warnings.push(message),
        adapter: {
          sourceId: "codex-cli",
          collect: async () => ({ events: [], cursorUpdates: [] }),
        },
      },
    );

    expect(warnings).toEqual([
      "Quarantined event runner-invalid-0001: invalid_payload",
    ]);
    expect(warnings.join(" ")).not.toContain("runner-secret-payload");
  });

  it("persists adapter cursor updates after enqueue", async () => {
    const dir = trackedTempDir("alfred-runner-cursor-");
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
          collect: async () => ({
            events: [secondEvent, firstEvent],
            cursorUpdates: [
              {
                key: "codex-session-cursor",
                value: "2026-04-28T10:05:00.000Z",
              },
            ],
          }),
        },
      },
    );

    const outbox = new OutboxDb(outboxPath);
    expect(outbox.getSourceCursor("codex-session-cursor")).toBe("2026-04-28T10:05:00.000Z");
    outbox.close();
  });

  it("advances explicit Codex since with the stored source cursor", async () => {
    const dir = trackedTempDir("alfred-runner-codex-cursor-");
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

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith("http://127.0.0.1:4301/v1/ingest/heartbeat", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
      },
    });
  });

  it("keeps independent cursors for concurrent Codex session files", async () => {
    const dir = trackedTempDir("alfred-runner-concurrent-cursors-");
    const codexHome = join(dir, ".codex");
    const sessionsDir = join(codexHome, "sessions/2026/04/28");
    const sessionA = join(sessionsDir, "session-a.jsonl");
    const sessionB = join(sessionsDir, "session-b.jsonl");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      sessionA,
      JSON.stringify({
        timestamp: "2026-04-28T10:00:00.000Z",
        type: "session.start",
        id: "session-a",
        cwd: "/Users/patryk/Desktop/Alfred",
      }),
    );
    writeFileSync(
      sessionB,
      JSON.stringify({
        timestamp: "2026-04-28T09:00:00.000Z",
        type: "session.start",
        id: "session-b",
        cwd: "/Users/patryk/Desktop/Alfred",
      }),
    );
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const config = {
      apiUrl: "http://127.0.0.1:4301",
      deviceToken: "token-1",
      workspaceId,
      deviceId,
      privacyMode: "standard" as const,
      outboxPath: join(dir, "outbox.sqlite"),
      codexHome,
    };

    await expect(runRunnerOnce(config, { fetchImpl })).resolves.toMatchObject({
      collectedEvents: 2,
    });

    appendFileSync(
      sessionB,
      `\n${JSON.stringify({
        timestamp: "2026-04-28T09:30:00.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "session-b-later",
        },
      })}`,
    );

    await expect(runRunnerOnce(config, { fetchImpl })).resolves.toMatchObject({
      collectedEvents: 1,
      flushedEvents: 1,
    });

    const request = (fetchImpl as unknown as FetchMock).mock.calls.at(-1)?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    const parsed = IngestBatchSchema.parse(body);
    expect(parsed.events).toContainEqual(
      expect.objectContaining({
        source_run_id: "session-b",
        source_event_id: "session-b-later",
        occurred_at: "2026-04-28T09:30:00.000Z",
      }),
    );
  });

  it("flushes queued data before surfacing an adapter collection failure", async () => {
    const dir = trackedTempDir("alfred-runner-collection-failure-");
    const outboxPath = join(dir, "outbox.sqlite");
    const outbox = new OutboxDb(outboxPath);
    enqueueValidEvent(outbox, "queued-event-000001");
    outbox.close();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));

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
            collect: async () => {
              throw new Error("source unavailable");
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      name: "AggregateError",
      message: "Runner collection failed",
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = (fetchImpl as unknown as FetchMock).mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    expect(IngestBatchSchema.parse(body).events.map((event) => event.event_id)).toEqual([
      "queued-event-000001",
    ]);
    const reopenedOutbox = new OutboxDb(outboxPath);
    expect(reopenedOutbox.countQueued()).toBe(0);
    reopenedOutbox.close();
  });

  it("surfaces collection and delivery failures while retaining the queued event", async () => {
    const dir = trackedTempDir("alfred-runner-combined-failure-");
    const outboxPath = join(dir, "outbox.sqlite");
    const outbox = new OutboxDb(outboxPath);
    enqueueValidEvent(outbox, "retry-event-000001");
    outbox.close();
    const collectionError = new Error("source unavailable");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));

    let surfacedError: unknown;
    try {
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
            collect: async () => {
              throw collectionError;
            },
          },
        },
      );
    } catch (error) {
      surfacedError = error;
    }

    expect(surfacedError).toMatchObject({
      name: "AggregateError",
      message: "Runner collection and delivery failed",
      errors: [
        collectionError,
        expect.objectContaining({
          name: "IngestRequestError",
          status: 500,
        }),
      ],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect((fetchImpl as unknown as FetchMock).mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4301/v1/ingest/batches",
    );

    const reopenedOutbox = new OutboxDb(outboxPath);
    expect(reopenedOutbox.countQueued()).toBe(1);
    expect(reopenedOutbox.listReady(10, new Date("2100-01-01T00:00:00.000Z"))).toEqual([
      expect.objectContaining({
        eventId: "retry-event-000001",
        attempts: 1,
      }),
    ]);
    reopenedOutbox.close();
  });

  it("continues other adapters and flushes their events before surfacing collection failures", async () => {
    const dir = trackedTempDir("alfred-runner-adapter-isolation-");
    const outboxPath = join(dir, "outbox.sqlite");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const collectionError = new Error("source unavailable");
    const failingCollect = vi.fn(async (): Promise<SourceCollection> => {
      throw collectionError;
    });
    const healthyEvent: IngestEvent = {
      event_id: "healthy-event-0001",
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
    const healthyCollect = vi.fn(async (): Promise<SourceCollection> => ({
      events: [healthyEvent],
      cursorUpdates: [
        {
          key: "healthy-session-cursor",
          value: "2026-04-28T10:03:00.000Z",
        },
      ],
    }));

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
            { sourceId: "codex-cli", collect: failingCollect },
            { sourceId: "claude-code", collect: healthyCollect },
          ],
        },
      ),
    ).rejects.toMatchObject({
      name: "AggregateError",
      message: "Runner collection failed",
      errors: [collectionError],
    });

    expect(failingCollect).toHaveBeenCalledOnce();
    expect(healthyCollect).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const request = (fetchImpl as unknown as FetchMock).mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    expect(IngestBatchSchema.parse(body).events.map((event) => event.event_id)).toEqual([
      "healthy-event-0001",
    ]);
    const outbox = new OutboxDb(outboxPath);
    expect(outbox.countQueued()).toBe(0);
    expect(outbox.getSourceCursor("healthy-session-cursor")).toBe("2026-04-28T10:03:00.000Z");
    outbox.close();
  });

  it("collects multiple source adapters", async () => {
    const dir = trackedTempDir("alfred-runner-multi-source-");
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
              collect: async () => ({ events: [codexEvent], cursorUpdates: [] }),
            },
            {
              sourceId: "claude-code",
              collect: async () => ({ events: [claudeEvent], cursorUpdates: [] }),
            },
          ],
        },
      ),
    ).resolves.toEqual({ collectedEvents: 2, flushedEvents: 2 });

    const request = (fetchImpl as unknown as FetchMock).mock.calls[0]?.[1];
    const body = typeof request?.body === "string" ? JSON.parse(request.body) : null;
    const parsed = IngestBatchSchema.parse(body);
    expect(parsed.events.map((event) => event.source_id)).toEqual(["codex-cli", "claude-code"]);

  });

  it("keeps polling while the runner loop is active", async () => {
    const dir = trackedTempDir("alfred-runner-loop-");
    const outboxPath = join(dir, "outbox.sqlite");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 202 }));
    const collect = vi
      .fn<() => Promise<SourceCollection>>()
      .mockResolvedValueOnce({
        events: [
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
        ],
        cursorUpdates: [],
      })
      .mockResolvedValueOnce({ events: [], cursorUpdates: [] });
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
    expect(fetchImpl).toHaveBeenLastCalledWith("http://127.0.0.1:4301/v1/ingest/heartbeat", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
      },
    });
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(1_500);
  });
});

function trackedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
