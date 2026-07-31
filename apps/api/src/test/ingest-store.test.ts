import {
  devices,
  events,
  ingestBatches,
  projects,
  runs,
  workspaces,
} from "@alfred/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

describe("production ingest store", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createPgliteIngestDatabase();
  }, 20_000);

  afterEach(async () => {
    await fixture.close();
  });

  it("persists a new batch through the production Drizzle store", async () => {
    const result = await ingestBatch(
      createDrizzleIngestStore(fixture.db),
      makeBatch(),
    );

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
