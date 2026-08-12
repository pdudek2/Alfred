import {
  devices,
  events,
  ingestBatches,
  projects,
  runRelations,
  runs,
  users,
  workspaces,
  type Database,
} from "@alfred/db";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedBootstrapAuth } from "../auth/bootstrap-auth";
import {
  createDrizzleIngestStore,
  ingestBatch,
  markRunnerHeartbeat,
} from "../services/ingest-service";
import {
  deviceId,
  makeBatch,
  otherWorkspaceId,
  workspaceId,
} from "./support/ingest-fixtures";
import {
  createPgliteIngestDatabase,
} from "./support/pglite-ingest-db";

type Fixture = Awaited<ReturnType<typeof createPgliteIngestDatabase>>;

const bootstrapUserId = "00000000-0000-4000-8000-000000000099";
const bootstrapEmail = "owner@example.test";

describe("production ingest store", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createPgliteIngestDatabase();
    await seedBootstrapAuth(fixture.db as unknown as Database, {
      adminEmail: bootstrapEmail,
      deviceId,
      deviceToken: "fixture-device-token",
      userId: bootstrapUserId,
      workspaceId,
    });
  }, 20_000);

  afterEach(async () => {
    await fixture.close();
  });

  async function readRun(sourceRunId = "run-1") {
    const [run] = await fixture.db
      .select({
        id: runs.id,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
      })
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, workspaceId),
          eq(runs.sourceId, "codex-cli"),
          eq(runs.sourceRunId, sourceRunId),
        ),
      );
    return run;
  }

  function store() {
    return createDrizzleIngestStore(fixture.db);
  }

  it("persists a new batch through the production Drizzle store", async () => {
    const result = await ingestBatch(store(), makeBatch());

    expect(result).toEqual({
      batch_id: "00000000-0000-4000-8000-000000000201",
      accepted_events: 1,
      duplicate_events: 0,
      duplicate_batch: false,
    });
    await expect(fixture.db.select().from(ingestBatches)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(projects)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(runs)).resolves.toHaveLength(1);
    await expect(fixture.db.select().from(events)).resolves.toHaveLength(1);
  });

  it("stores and refreshes the readable name for an opaque project key", async () => {
    const db = store();
    await ingestBatch(db, makeBatch("00000000-0000-4000-8000-000000000301", {
      project_key: "local-git-v1:abc123",
      project_name: "Alfred",
    }));
    await ingestBatch(db, makeBatch("00000000-0000-4000-8000-000000000302", {
      event_id: "event-000000000002",
      source_event_id: "source-event-2",
      project_key: "local-git-v1:abc123",
      project_name: "Alfred Desktop",
    }));
    await ingestBatch(db, makeBatch("00000000-0000-4000-8000-000000000303", {
      event_id: "event-000000000003",
      source_event_id: "source-event-3",
      project_key: "local-git-v1:abc123",
    }));
    await expect(fixture.db.select({ key: projects.projectKey, name: projects.name }).from(projects))
      .resolves.toEqual([{ key: "local-git-v1:abc123", name: "Alfred Desktop" }]);
  });

  it("keeps the project key as the name for older runners", async () => {
    await ingestBatch(store(), makeBatch());
    await expect(fixture.db.select({ name: projects.name }).from(projects))
      .resolves.toEqual([{ name: "alfred" }]);
  });

  it("preserves the bootstrap workspace owner during ingest and heartbeat", async () => {
    await ingestBatch(store(), makeBatch());

    await expect(
      fixture.db
        .select({ id: users.id, email: users.email })
        .from(users),
    ).resolves.toEqual([{ id: bootstrapUserId, email: bootstrapEmail }]);

    await expect(
      fixture.db
        .select({ id: workspaces.id, ownerUserId: workspaces.ownerUserId })
        .from(workspaces),
    ).resolves.toEqual([{ id: workspaceId, ownerUserId: bootstrapUserId }]);

    await markRunnerHeartbeat(store(), {
      workspaceId,
      deviceId,
      seenAt: new Date("2026-01-01T10:05:00.000Z"),
    });

    await expect(
      fixture.db
        .select({ id: users.id, email: users.email })
        .from(users),
    ).resolves.toEqual([{ id: bootstrapUserId, email: bootstrapEmail }]);

    await expect(
      fixture.db
        .select({ id: workspaces.id, ownerUserId: workspaces.ownerUserId })
        .from(workspaces),
    ).resolves.toEqual([{ id: workspaceId, ownerUserId: bootstrapUserId }]);
  });

  it("accepts the same batch twice without duplicating events", async () => {
    const db = store();
    const batch = makeBatch("00000000-0000-4000-8000-000000000201");
    const first = await ingestBatch(db, batch);
    const second = await ingestBatch(db, batch);

    expect(first.accepted_events).toBe(1);
    expect(second.accepted_events).toBe(0);
    expect(second.duplicate_batch).toBe(true);
  });

  it("updates an existing run with completion status and timestamp", async () => {
    const db = store();

    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000201", {
        source_event_id: "source-event-started",
        event_id: "event-000000000001",
        type: "run.started",
        status: "running",
        occurred_at: "2026-01-01T10:00:00.000Z",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000202", {
        source_event_id: "source-event-completed",
        event_id: "event-000000000002",
        type: "run.completed",
        status: "completed",
        occurred_at: "2026-01-01T10:05:00.000Z",
      }),
    );

    expect(await readRun()).toMatchObject({
      status: "completed",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      completedAt: new Date("2026-01-01T10:05:00.000Z"),
    });
  });

  it("reopens an existing run when more activity arrives after a completed turn", async () => {
    const db = store();

    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000201", {
        source_event_id: "source-event-started",
        event_id: "event-000000000001",
        type: "run.started",
        status: "running",
        occurred_at: "2026-01-01T10:00:00.000Z",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000202", {
        source_event_id: "source-event-completed",
        event_id: "event-000000000002",
        type: "run.completed",
        status: "completed",
        occurred_at: "2026-01-01T10:05:00.000Z",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000203", {
        source_event_id: "source-event-waiting",
        event_id: "event-000000000003",
        type: "agent.waiting",
        status: "waiting",
        occurred_at: "2026-01-01T10:06:00.000Z",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000204", {
        source_event_id: "source-event-tool",
        event_id: "event-000000000004",
        type: "tool.started",
        occurred_at: "2026-01-01T10:07:00.000Z",
      }),
    );

    expect(await readRun()).toMatchObject({
      status: "running",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      completedAt: null,
    });
  });

  it("does not reopen a terminal run from an older waiting event", async () => {
    const db = store();

    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000201", {
        source_event_id: "source-event-completed",
        event_id: "event-000000000001",
        type: "run.completed",
        status: "completed",
        occurred_at: "2026-01-01T10:05:00.000Z",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000202", {
        source_event_id: "source-event-waiting",
        event_id: "event-000000000002",
        type: "agent.waiting",
        status: "waiting",
        occurred_at: "2026-01-01T10:04:00.000Z",
      }),
    );

    expect(await readRun()).toMatchObject({
      status: "completed",
      completedAt: new Date("2026-01-01T10:05:00.000Z"),
    });
  });

  it("closes an existing run when a run update marks it cancelled", async () => {
    const db = store();

    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000201", {
        source_event_id: "source-event-started",
        event_id: "event-000000000001",
        type: "run.started",
        status: "running",
        occurred_at: "2026-01-01T10:00:00.000Z",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000202", {
        source_event_id: "source-event-cancelled",
        event_id: "event-000000000002",
        type: "run.updated",
        status: "cancelled",
        occurred_at: "2026-01-01T10:03:00.000Z",
      }),
    );

    expect(await readRun()).toMatchObject({
      status: "cancelled",
      startedAt: new Date("2026-01-01T10:00:00.000Z"),
      completedAt: new Date("2026-01-01T10:03:00.000Z"),
    });
  });

  it("counts duplicate events across different batches", async () => {
    const db = store();
    const first = await ingestBatch(db, makeBatch("00000000-0000-4000-8000-000000000201"));
    const second = await ingestBatch(db, makeBatch("00000000-0000-4000-8000-000000000202"));

    expect(first).toMatchObject({
      accepted_events: 1,
      duplicate_events: 0,
      duplicate_batch: false,
    });
    expect(second).toMatchObject({
      accepted_events: 0,
      duplicate_events: 1,
      duplicate_batch: false,
    });
  });

  it("persists canonically distinct events that share a source event ID", async () => {
    const started = makeBatch("00000000-0000-4000-8000-000000000221", {
      event_id: "event-shared-source-started",
      source_event_id: "shared-source-event",
      source_run_id: "run-a",
      type: "run.started",
      status: "running",
    });
    const completed = makeBatch("00000000-0000-4000-8000-000000000222", {
      event_id: "event-shared-source-completed",
      source_event_id: "shared-source-event",
      source_run_id: "run-b",
      type: "run.completed",
      status: "completed",
    });

    await expect(ingestBatch(store(), started)).resolves.toMatchObject({
      accepted_events: 1,
      duplicate_events: 0,
    });
    await expect(ingestBatch(store(), completed)).resolves.toMatchObject({
      accepted_events: 1,
      duplicate_events: 0,
    });
    await expect(fixture.db.select().from(events)).resolves.toHaveLength(2);
  });

  it("keeps an existing run status when a technical event has no status", async () => {
    const db = store();

    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000201", {
        source_event_id: "source-event-started",
        event_id: "event-000000000001",
        type: "run.started",
        status: "running",
      }),
    );
    await ingestBatch(
      db,
      makeBatch("00000000-0000-4000-8000-000000000202", {
        source_event_id: "source-event-tool",
        event_id: "event-000000000002",
        type: "tool.completed",
        status: undefined,
      }),
    );

    expect((await readRun())?.status).toBe("running");
  });

  it("does not complete a running parent when its child completes", async () => {
    await ingestBatch(
      store(),
      makeBatch("00000000-0000-4000-8000-000000000211", {
        event_id: "event-parent-started",
        source_event_id: "source-parent-started",
        source_run_id: "parent-run",
        type: "run.started",
        status: "running",
        occurred_at: "2026-01-01T10:00:00.000Z",
      }),
    );

    await ingestBatch(
      store(),
      makeBatch("00000000-0000-4000-8000-000000000212", {
        event_id: "event-child-completed",
        source_event_id: "source-child-completed",
        source_run_id: "child-run",
        parent_source_run_id: "parent-run",
        type: "run.completed",
        status: "completed",
        occurred_at: "2026-01-01T10:05:00.000Z",
      }),
    );

    const parent = await readRun("parent-run");
    const child = await readRun("child-run");
    const relations = await fixture.db.select().from(runRelations);

    expect(parent).toMatchObject({
      status: "running",
      completedAt: null,
    });
    expect(child).toMatchObject({
      status: "completed",
      completedAt: new Date("2026-01-01T10:05:00.000Z"),
    });
    expect(relations).toEqual([
      expect.objectContaining({
        parentRunId: parent?.id,
        childRunId: child?.id,
        relationType: "parent",
      }),
    ]);
  });

  it("rejects ingest when the device belongs to another workspace", async () => {
    const store = createDrizzleIngestStore(fixture.db);
    await ingestBatch(store, makeBatch());

    await expect(
      ingestBatch(
        store,
        makeBatch(
          "00000000-0000-4000-8000-000000000202",
          {
            event_id: "event-000000000002",
            source_event_id: "source-event-2",
          },
          otherWorkspaceId,
        ),
      ),
    ).rejects.toThrow("Device belongs to another workspace");

    await expect(
      fixture.db.select({ workspaceId: devices.workspaceId }).from(devices),
    ).resolves.toEqual([{ workspaceId }]);
    await expect(
      fixture.db.select({ workspaceId: ingestBatches.workspaceId }).from(ingestBatches),
    ).resolves.toEqual([{ workspaceId }]);
    await expect(
      fixture.db.select({ workspaceId: workspaces.id }).from(workspaces),
    ).resolves.toEqual([{ workspaceId }]);
  });

  it("rejects a heartbeat when the device belongs to another workspace", async () => {
    const store = createDrizzleIngestStore(fixture.db);
    await ingestBatch(store, makeBatch());

    await expect(
      markRunnerHeartbeat(store, {
        workspaceId: otherWorkspaceId,
        deviceId,
        seenAt: new Date("2026-01-01T10:05:00.000Z"),
      }),
    ).rejects.toThrow("Device belongs to another workspace");

    await expect(
      fixture.db
        .select({
          workspaceId: devices.workspaceId,
          lastSeenAt: devices.lastSeenAt,
        })
        .from(devices),
    ).resolves.toEqual([
      {
        workspaceId,
        lastSeenAt: new Date("2026-01-01T10:00:00.000Z"),
      },
    ]);
    await expect(
      fixture.db.select({ workspaceId: workspaces.id }).from(workspaces),
    ).resolves.toEqual([{ workspaceId }]);
  });
});
