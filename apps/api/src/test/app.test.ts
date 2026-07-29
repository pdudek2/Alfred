import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDbDeviceAuthStore,
  createFallbackDeviceAuthStore,
  createStaticDeviceAuthStore,
  requireDeviceToken,
} from "../auth/device-auth";
import { hashToken } from "../auth/token-hash";

const dbMock = vi.hoisted(() => ({}));

const bootstrapAuthMock = vi.hoisted(() => ({
  seedBootstrapAuth: vi.fn(),
}));

vi.mock("@alfred/db", () => ({
  LOCAL_USER_ID: "local-user",
  createDb: () => dbMock,
  devices: {},
  events: {},
  ingestBatches: {},
  projects: {},
  runRelations: {},
  runs: {},
  updatedAtNow: {},
  users: {},
  workspaces: {},
}));

vi.mock("@alfred/schema", () => ({
  LOCAL_USER_ID: "00000000-0000-4000-8000-000000000011",
  LOCAL_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
  LOCAL_DEVICE_ID: "00000000-0000-4000-8000-000000000101",
  IngestBatchSchema: {
    safeParse: vi.fn(() => ({ success: false })),
  },
}));

vi.mock("../auth/bootstrap-auth", () => bootstrapAuthMock);

import { createApp } from "../app";

describe("api", () => {
  beforeEach(() => {
    bootstrapAuthMock.seedBootstrapAuth.mockReset();
    bootstrapAuthMock.seedBootstrapAuth.mockResolvedValue(undefined);
  });

  it("returns endpoint metadata at the root", async () => {
    const res = await createApp().request("/");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      service: "alfred-api",
      endpoints: {
        health: "/health",
        heartbeat: "/v1/ingest/heartbeat",
        batches: "/v1/ingest/batches",
      },
    });
  });

  it("returns health", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      service: "alfred-api",
      version: "0.0.0",
    });
  });

  const retiredRoutes = [
    { method: "GET", path: "/auth/login" },
    { method: "GET", path: "/auth/callback" },
    { method: "POST", path: "/auth/logout" },
    { method: "GET", path: "/api/auth/login" },
    { method: "GET", path: "/api/auth/callback" },
    { method: "POST", path: "/api/auth/logout" },
    { method: "GET", path: "/v1/runs" },
    { method: "GET", path: "/v1/runs/retired-run" },
    { method: "GET", path: "/api/v1/runs" },
    { method: "GET", path: "/api/v1/runs/retired-run" },
    { method: "GET", path: "/v1/system/status" },
    { method: "GET", path: "/api/v1/system/status" },
  ] as const;

  it.each(retiredRoutes)("$method $path returns the default 404", async ({ method, path }) => {
    const response = await createApp().request(path, { method });
    expect(response.status).toBe(404);
  });

  it.each(["/v1/ingest/heartbeat", "/api/v1/ingest/heartbeat"])("%s requires a device token", async (path) => {
    const response = await createApp().request(path, { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("keeps root, health, and retired routes available when bootstrap auth fails", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    bootstrapAuthMock.seedBootstrapAuth.mockRejectedValue(new Error("bootstrap unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const app = createApp();

      const root = await app.request("/");
      const health = await app.request("/health");
      const retired = await app.request("/auth/login");
      const ingest = await app.request("/api/v1/ingest/heartbeat", { method: "POST" });

      expect(root.status).toBe(200);
      expect(health.status).toBe(200);
      expect(retired.status).toBe(404);
      expect(ingest.status).toBeGreaterThanOrEqual(500);
      expect(bootstrapAuthMock.seedBootstrapAuth).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: "bootstrap unavailable" }));
    } finally {
      consoleError.mockRestore();
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("retries bootstrap auth after a rejected attempt", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    bootstrapAuthMock.seedBootstrapAuth
      .mockRejectedValueOnce(new Error("temporary bootstrap failure"))
      .mockResolvedValueOnce(undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const app = createApp();

      const first = await app.request("/api/v1/ingest/heartbeat", { method: "POST" });
      const second = await app.request("/api/v1/ingest/heartbeat", { method: "POST" });

      expect(first.status).toBeGreaterThanOrEqual(500);
      expect(second.status).toBe(401);
      expect(bootstrapAuthMock.seedBootstrapAuth).toHaveBeenCalledTimes(2);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "temporary bootstrap failure" }),
      );
    } finally {
      consoleError.mockRestore();
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("rejects missing device token", async () => {
    const app = new Hono();
    app.use(
      "/private/*",
      requireDeviceToken({
        authenticateDeviceToken: async (token) =>
          token === "secret"
            ? {
                workspaceId: "workspace-1",
                deviceId: "device-1",
              }
            : null,
      }),
    );
    app.get("/private/ping", (c) => c.json({ ok: true }));

    const res = await app.request("/private/ping");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("allows valid device token", async () => {
    const app = new Hono();
    app.use(
      "/private/*",
      requireDeviceToken({
        authenticateDeviceToken: async (token) =>
          token === "secret"
            ? {
                workspaceId: "workspace-1",
                deviceId: "device-1",
              }
            : null,
      }),
    );
    app.get("/private/ping", (c) => c.json({ ok: true }));

    const res = await app.request("/private/ping", {
      headers: { Authorization: "Bearer secret" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("does not fall back to static device auth after a primary auth miss", async () => {
    const primary = { authenticateDeviceToken: vi.fn(async () => null) };
    const fallback = createStaticDeviceAuthStore("secret", "workspace-1", "device-1");
    const store = createFallbackDeviceAuthStore(primary, fallback, true);

    await expect(store.authenticateDeviceToken("secret")).resolves.toBeNull();
    expect(primary.authenticateDeviceToken).toHaveBeenCalledWith("secret");
  });

  it("uses static device auth only when the primary store throws in local fallback mode", async () => {
    const primary = {
      authenticateDeviceToken: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
    };
    const fallback = createStaticDeviceAuthStore("secret", "workspace-1", "device-1");
    const store = createFallbackDeviceAuthStore(primary, fallback, true);

    await expect(store.authenticateDeviceToken("secret")).resolves.toEqual({
      workspaceId: "workspace-1",
      deviceId: "device-1",
    });
  });

  it("authenticates devices by stored token hash", async () => {
    const store = createDbDeviceAuthStore(createDeviceAuthDb("secret"));

    await expect(store.authenticateDeviceToken("secret")).resolves.toEqual({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      deviceId: "00000000-0000-4000-8000-000000000101",
    });
    expect(hashToken("secret")).not.toBe("secret");
  });
});

function createDeviceAuthDb(expectedToken: string) {
  return {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: () => {
            void condition;
            return Promise.resolve(
              hashToken(expectedToken) === hashToken("secret")
                ? [
                    {
                      workspaceId: "00000000-0000-4000-8000-000000000001",
                      deviceId: "00000000-0000-4000-8000-000000000101",
                    },
                  ]
                : [],
            );
          },
        }),
      }),
    }),
  } as never;
}
