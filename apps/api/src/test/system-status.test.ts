import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { createStaticSessionStore } from "../auth/session-auth";
import { createSystemRoutes } from "../routes/system";
import { buildRunnerStatus } from "../services/runner-status-service";
import { createSystemStatusStore } from "../services/system-status-store";

const now = new Date("2026-04-30T12:00:00.000Z");

describe("runner status service", () => {
  it("reports live when the runner was seen recently", () => {
    expect(
      buildRunnerStatus({
        now,
        lastDeviceSeenAt: new Date("2026-04-30T11:59:50.000Z"),
        lastIngestAt: new Date("2026-04-30T11:59:55.000Z"),
        latestRunUpdatedAt: new Date("2026-04-30T11:59:56.000Z"),
      }),
    ).toEqual({
      state: "live",
      last_device_seen_at: "2026-04-30T11:59:50.000Z",
      last_ingest_at: "2026-04-30T11:59:55.000Z",
      latest_run_updated_at: "2026-04-30T11:59:56.000Z",
      seconds_since_last_ingest: 5,
    });
  });

  it("reports quiet when the runner exists but has not ingested recently", () => {
    expect(
      buildRunnerStatus({
        now,
        lastDeviceSeenAt: new Date("2026-04-30T11:40:00.000Z"),
        lastIngestAt: new Date("2026-04-30T11:30:00.000Z"),
        latestRunUpdatedAt: new Date("2026-04-30T11:30:00.000Z"),
      }).state,
    ).toBe("quiet");
  });

  it("reports offline when there is no device heartbeat", () => {
    expect(
      buildRunnerStatus({
        now,
        lastDeviceSeenAt: null,
        lastIngestAt: null,
        latestRunUpdatedAt: null,
      }).state,
    ).toBe("offline");
  });
});

describe("system status routes", () => {
  it("requires a session", async () => {
    const app = createSystemRoutes(
      {
        getTimestamps: async () => ({
          lastDeviceSeenAt: now,
          lastIngestAt: now,
          latestRunUpdatedAt: now,
        }),
      },
      createStaticSessionStore("dev-session-token", {
        userId: "00000000-0000-4000-8000-000000000011",
        email: "local@alfred.local",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      }),
    );

    const response = await app.request("/status");

    expect(response.status).toBe(401);
  });

  it("returns freshness for the authenticated workspace", async () => {
    let observedWorkspaceId: string | null = null;
    const recentDeviceSeenAt = new Date(Date.now() - 10_000);
    const recentIngestAt = new Date(Date.now() - 5_000);
    const recentRunUpdatedAt = new Date(Date.now() - 4_000);
    const app = createSystemRoutes(
      {
        getTimestamps: async (workspaceId) => {
          observedWorkspaceId = workspaceId;
          return {
            lastDeviceSeenAt: recentDeviceSeenAt,
            lastIngestAt: recentIngestAt,
            latestRunUpdatedAt: recentRunUpdatedAt,
          };
        },
      },
      createStaticSessionStore("dev-session-token", {
        userId: "00000000-0000-4000-8000-000000000011",
        email: "local@alfred.local",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      }),
    );

    const response = await app.request("/status", {
      headers: { cookie: "alfred_session=dev-session-token" },
    });

    expect(response.status).toBe(200);
    expect(observedWorkspaceId).toBe("00000000-0000-4000-8000-000000000001");
    await expect(response.json()).resolves.toMatchObject({
      runner: {
        state: "live",
        seconds_since_last_ingest: expect.any(Number),
      },
    });
  });
});

describe("system status store", () => {
  it("filters nullable freshness timestamps before ordering", async () => {
    const db = createRecordingDb();
    const store = createSystemStatusStore(db as never);

    await expect(store.getTimestamps("00000000-0000-4000-8000-000000000001")).resolves.toEqual({
      lastDeviceSeenAt: new Date("2026-04-30T11:59:50.000Z"),
      lastIngestAt: new Date("2026-04-30T11:59:55.000Z"),
      latestRunUpdatedAt: new Date("2026-04-30T11:59:56.000Z"),
    });

    expect(db.whereSql[0]).toContain('"devices"."workspace_id" = $1');
    expect(db.whereSql[0]).toContain('"devices"."last_seen_at" is not null');
    expect(db.whereSql[1]).toContain('"ingest_batches"."workspace_id" = $1');
    expect(db.whereSql[1]).toContain('"ingest_batches"."processed_at" is not null');
    expect(db.whereSql[2]).toContain('"runs"."workspace_id" = $1');
    expect(db.whereSql[2]).toContain('"runs"."updated_at" is not null');
  });
});

function createRecordingDb() {
  const rows = [
    [{ lastSeenAt: new Date("2026-04-30T11:59:50.000Z") }],
    [{ processedAt: new Date("2026-04-30T11:59:55.000Z") }],
    [{ updatedAt: new Date("2026-04-30T11:59:56.000Z") }],
  ];
  let queryIndex = 0;
  const whereSql: string[] = [];

  return {
    whereSql,
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          whereSql.push(normalizeSql(condition as SQL));
          const result = rows[queryIndex++] ?? [];
          return {
            orderBy: () => ({
              limit: () => Promise.resolve(result),
            }),
          };
        },
      }),
    }),
  };
}

function normalizeSql(value: SQL): string {
  return new PgDialect().sqlToQuery(value).sql.replace(/\s+/g, " ").trim();
}
