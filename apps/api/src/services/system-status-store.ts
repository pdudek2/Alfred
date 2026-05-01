import { devices, ingestBatches, runs, type Database } from "@alfred/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";

export type SystemStatusTimestamps = {
  lastDeviceSeenAt: Date | null;
  lastIngestAt: Date | null;
  latestRunUpdatedAt: Date | null;
};

export type SystemStatusStore = {
  getTimestamps(workspaceId: string): Promise<SystemStatusTimestamps>;
};

export function createSystemStatusStore(db: Database): SystemStatusStore {
  return {
    async getTimestamps(workspaceId) {
      const [latestDevice] = await db
        .select({ lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(and(eq(devices.workspaceId, workspaceId), isNotNull(devices.lastSeenAt)))
        .orderBy(desc(devices.lastSeenAt))
        .limit(1);

      const [latestIngest] = await db
        .select({ processedAt: ingestBatches.processedAt })
        .from(ingestBatches)
        .where(and(eq(ingestBatches.workspaceId, workspaceId), isNotNull(ingestBatches.processedAt)))
        .orderBy(desc(ingestBatches.processedAt))
        .limit(1);

      const [latestRun] = await db
        .select({ updatedAt: runs.updatedAt })
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), isNotNull(runs.updatedAt)))
        .orderBy(desc(runs.updatedAt))
        .limit(1);

      return {
        lastDeviceSeenAt: latestDevice?.lastSeenAt ?? null,
        lastIngestAt: latestIngest?.processedAt ?? null,
        latestRunUpdatedAt: latestRun?.updatedAt ?? null,
      };
    },
  };
}
