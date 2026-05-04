import {
  and,
  eq,
  sql,
} from "drizzle-orm";
import {
  devices,
  events,
  ingestBatches,
  LOCAL_USER_ID,
  projects,
  runRelations,
  runs,
  updatedAtNow,
  users,
  workspaces,
  type Database,
} from "@alfred/db";
import type { IngestBatch, IngestEvent } from "@alfred/schema";

export type IngestBatchResult = {
  batch_id: string;
  accepted_events: number;
  duplicate_events: number;
  duplicate_batch: boolean;
};

type ProjectRecord = {
  id: string;
};

type RunRecord = {
  id: string;
};

type DevicePresence = Pick<IngestBatch, "workspace_id" | "device_id" | "sent_at">;

type DrizzleIngestDb = Pick<Database, "insert" | "update"> & {
  transaction?: Database["transaction"];
  select?: Database["select"];
};

export type IngestStore = {
  transaction<T>(fn: (store: IngestStore) => Promise<T>): Promise<T>;
  insertBatchIfNew(batch: IngestBatch): Promise<boolean>;
  markBatchAccepted(batch: IngestBatch, acceptedEvents: number, duplicateEvents: number): Promise<void>;
  ensureWorkspace(workspaceId: string): Promise<void>;
  ensureDevice(device: DevicePresence): Promise<void>;
  markDeviceSeen(workspaceId: string, deviceId: string, seenAt: Date): Promise<void>;
  upsertProject(event: IngestEvent): Promise<ProjectRecord>;
  upsertRun(event: IngestEvent, projectId: string): Promise<RunRecord>;
  upsertRelation(event: IngestEvent, parentRunId: string, childRunId: string): Promise<void>;
  insertEvent(event: IngestEvent, projectId: string, runId: string): Promise<boolean>;
};

export async function ingestBatch(db: Database | IngestStore, batch: IngestBatch): Promise<IngestBatchResult> {
  const store = isIngestStore(db) ? db : createDrizzleIngestStore(db);

  return store.transaction(async (tx) => {
    await tx.ensureWorkspace(batch.workspace_id);
    await tx.ensureDevice(batch);

    const insertedBatch = await tx.insertBatchIfNew(batch);
    if (!insertedBatch) {
      return {
        batch_id: batch.batch_id,
        accepted_events: 0,
        duplicate_events: 0,
        duplicate_batch: true,
      };
    }

    let acceptedEvents = 0;
    let duplicateEvents = 0;

    for (const event of batch.events) {
      const project = await tx.upsertProject(event);
      const run = await tx.upsertRun(event, project.id);

      if (event.parent_source_run_id) {
        const parentRun = await tx.upsertRun(
          {
            ...event,
            source_run_id: event.parent_source_run_id,
            source_event_id: `${event.source_event_id}:parent`,
            event_id: `${event.event_id}:parent`,
            status: "unknown",
          },
          project.id,
        );
        await tx.upsertRelation(event, parentRun.id, run.id);
      }

      const insertedEvent = await tx.insertEvent(event, project.id, run.id);
      if (insertedEvent) {
        acceptedEvents += 1;
      } else {
        duplicateEvents += 1;
      }
    }

    await tx.markBatchAccepted(batch, acceptedEvents, duplicateEvents);

    return {
      batch_id: batch.batch_id,
      accepted_events: acceptedEvents,
      duplicate_events: duplicateEvents,
      duplicate_batch: false,
    };
  });
}

export async function markRunnerHeartbeat(
  db: Database | IngestStore,
  input: { workspaceId: string; deviceId: string; seenAt?: Date },
): Promise<{ ok: true; last_seen_at: string }> {
  const store = isIngestStore(db) ? db : createDrizzleIngestStore(db);
  const seenAt = input.seenAt ?? new Date();

  await store.transaction(async (tx) => {
    await tx.ensureWorkspace(input.workspaceId);
    await tx.ensureDevice({
      workspace_id: input.workspaceId,
      device_id: input.deviceId,
      sent_at: seenAt.toISOString(),
    });
    await tx.markDeviceSeen(input.workspaceId, input.deviceId, seenAt);
  });

  return {
    ok: true,
    last_seen_at: seenAt.toISOString(),
  };
}

function isIngestStore(value: Database | IngestStore): value is IngestStore {
  return "insertBatchIfNew" in value;
}

function runStatusFor(event: IngestEvent) {
  if (event.type === "run.started") return "running";
  if (event.type === "run.completed") return "completed";
  if (event.type === "run.failed") return "failed";
  if (event.type === "agent.waiting") return "waiting";
  if (event.type === "tool.started") return "running";
  if (event.status && event.type.startsWith("run.")) return event.status;
  return null;
}

function runTimestampsFor(event: IngestEvent) {
  const occurredAt = new Date(event.occurred_at);
  return {
    startedAt: event.type === "run.started" ? occurredAt : null,
    completedAt: event.type === "run.completed" || event.type === "run.failed" ? occurredAt : null,
  };
}

function createDrizzleIngestStore(db: DrizzleIngestDb): IngestStore {
  return {
    transaction: async (fn) => {
      if (!db.transaction) {
        return fn(createDrizzleIngestStore(db));
      }

      return db.transaction((tx) => fn(createDrizzleIngestStore(tx as unknown as DrizzleIngestDb)));
    },

    insertBatchIfNew: async (batch) => {
      const [inserted] = await db
        .insert(ingestBatches)
        .values({
          workspaceId: batch.workspace_id,
          deviceId: batch.device_id,
          batchId: batch.batch_id,
          sourceId: batch.events[0]?.source_id,
          eventCount: batch.events.length,
          acceptedCount: 0,
          rejectedCount: 0,
          sentAt: new Date(batch.sent_at),
          payload: { batch_id: batch.batch_id },
        })
        .onConflictDoNothing()
        .returning({ id: ingestBatches.id });

      return Boolean(inserted);
    },

    markBatchAccepted: async (batch, acceptedEvents, duplicateEvents) => {
      await db
        .update(ingestBatches)
        .set({
          acceptedCount: acceptedEvents,
          rejectedCount: duplicateEvents,
          processedAt: new Date(),
          updatedAt: updatedAtNow,
        })
        .where(
          and(
            eq(ingestBatches.workspaceId, batch.workspace_id),
            eq(ingestBatches.batchId, batch.batch_id),
          ),
        );
    },

    ensureWorkspace: async (workspaceId) => {
      await db
        .insert(users)
        .values({
          id: LOCAL_USER_ID,
          email: "local@alfred.local",
          displayName: "Local User",
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { updatedAt: updatedAtNow },
        });

      await db
        .insert(workspaces)
        .values({
          id: workspaceId,
          ownerUserId: LOCAL_USER_ID,
          workspaceKey: workspaceId,
          name: "Personal Workspace",
        })
        .onConflictDoUpdate({
          target: workspaces.id,
          set: { updatedAt: updatedAtNow },
        });
    },

    ensureDevice: async (batch) => {
      if (db.select) {
        const [existingDevice] = await db
          .select({
            workspaceId: devices.workspaceId,
          })
          .from(devices)
          .where(eq(devices.id, batch.device_id))
          .limit(1);

        if (existingDevice && existingDevice.workspaceId !== batch.workspace_id) {
          throw new Error("Device belongs to another workspace");
        }
      }

      await db
        .insert(devices)
        .values({
          id: batch.device_id,
          workspaceId: batch.workspace_id,
          deviceKey: batch.device_id,
          name: "Runner Device",
          lastSeenAt: new Date(batch.sent_at),
        })
        .onConflictDoUpdate({
          target: devices.id,
          set: {
            lastSeenAt: new Date(batch.sent_at),
            updatedAt: updatedAtNow,
          },
        });
    },

    markDeviceSeen: async (workspaceId, deviceId, seenAt) => {
      await db
        .update(devices)
        .set({
          lastSeenAt: seenAt,
          updatedAt: updatedAtNow,
        })
        .where(and(eq(devices.workspaceId, workspaceId), eq(devices.id, deviceId)));
    },

    upsertProject: async (event) => {
      const [project] = await db
        .insert(projects)
        .values({
          workspaceId: event.workspace_id,
          projectKey: event.project_key,
          name: event.project_key,
        })
        .onConflictDoUpdate({
          target: [projects.workspaceId, projects.projectKey],
          set: { updatedAt: updatedAtNow },
        })
        .returning({ id: projects.id });

      if (!project) throw new Error("Failed to upsert project");
      return project;
    },

    upsertRun: async (event, projectId) => {
      const timestamps = runTimestampsFor(event);
      const [run] = await db
        .insert(runs)
        .values({
          workspaceId: event.workspace_id,
          deviceId: event.device_id,
          projectId,
          sourceId: event.source_id,
          sourceRunId: event.source_run_id,
          status: runStatusFor(event) ?? "unknown",
          privacyMode: event.privacy_mode,
          startedAt: timestamps.startedAt,
          completedAt: timestamps.completedAt,
        })
        .onConflictDoUpdate({
          target: [runs.workspaceId, runs.sourceId, runs.sourceRunId],
          set: {
            deviceId: event.device_id,
            projectId,
            status: sql`case when excluded.status <> 'unknown' then excluded.status else ${runs.status} end`,
            privacyMode: event.privacy_mode,
            startedAt: sql`coalesce(excluded.started_at, ${runs.startedAt})`,
            completedAt: sql`case when excluded.status in ('running', 'waiting') then null else coalesce(excluded.completed_at, ${runs.completedAt}) end`,
            updatedAt: updatedAtNow,
          },
        })
        .returning({ id: runs.id });

      if (!run) throw new Error("Failed to upsert run");
      return run;
    },

    upsertRelation: async (event, parentRunId, childRunId) => {
      await db
        .insert(runRelations)
        .values({
          workspaceId: event.workspace_id,
          parentRunId,
          childRunId,
          relationType: "parent",
        })
        .onConflictDoNothing();
    },

    insertEvent: async (event, projectId, runId) => {
      const [inserted] = await db
        .insert(events)
        .values({
          workspaceId: event.workspace_id,
          eventId: event.event_id,
          deviceId: event.device_id,
          projectId,
          runId,
          sourceId: event.source_id,
          sourceRunId: event.source_run_id,
          sourceEventId: event.source_event_id,
          type: event.type,
          status: event.status,
          privacyMode: event.privacy_mode,
          occurredAt: new Date(event.occurred_at),
          payload: event.payload,
        })
        .onConflictDoNothing()
        .returning({ id: events.id });

      return Boolean(inserted);
    },
  };
}
