import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbDeviceAuthStore, requireDeviceToken } from "../auth/device-auth";
import { hashToken } from "../auth/token-hash";
import { createAuthRoutes } from "../routes/auth";
import type { RunListItem } from "../services/runs-query-service";

const dbMock = vi.hoisted(() => ({
  getRun: vi.fn(),
  listRuns: vi.fn(),
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

import { createApp } from "../app";

const run: RunListItem = {
  id: "run-1",
  workspace_id: "00000000-0000-4000-8000-000000000001",
  project_id: "project-1",
  project_key: "Alfred",
  project_name: "Alfred",
  source_id: "codex-cli",
  source_run_id: "codex-run-1",
  status: "running",
  lifecycle_status: "running",
  title: null,
  started_at: "2026-04-28T10:00:00.000Z",
  completed_at: null,
  last_activity_at: "2026-04-28T10:00:01.000Z",
  updated_at: "2026-04-28T10:01:00.000Z",
  created_at: "2026-04-28T10:00:00.000Z",
};

describe("api", () => {
  beforeEach(() => {
    dbMock.getRun.mockReset();
    dbMock.listRuns.mockReset();
    dbMock.getRun.mockResolvedValue(null);
    dbMock.listRuns.mockResolvedValue([run]);
  });

  it("returns endpoint metadata at the root", async () => {
    const res = await createApp().request("/");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      service: "alfred-api",
      endpoints: {
        health: "/health",
        runs: "/v1/runs",
        webPrefixedRuns: "/api/v1/runs",
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

  it("keeps the web-prefixed runs endpoint compatible", async () => {
    const res = await createApp().request("/api/v1/runs?limit=7", {
      headers: { cookie: "alfred_session=dev-session-token" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [run] });
    expect(dbMock.listRuns).toHaveBeenCalledOnce();
    expect(dbMock.listRuns).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001", 7, {});
  });

  it("sets a dev session cookie from login when OIDC is not configured in dev auth mode", async () => {
    const res = await createApp().request("/auth/login", { redirect: "manual" });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("alfred_session=dev-session-token");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("allows runs after the dev login cookie is issued", async () => {
    const login = await createApp().request("/auth/login", { redirect: "manual" });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];

    const res = await createApp().request("/api/v1/runs?limit=7", {
      headers: cookie ? { cookie } : {},
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [run] });
    expect(dbMock.listRuns).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001", 7, {});
  });

  it("mounts system status behind session auth", async () => {
    const res = await createApp().request("/api/v1/system/status");
    expect(res.status).toBe(401);
  });

  it("supports Vercel cloud aliases for health and auth", async () => {
    const health = await createApp().request("/api/health");
    expect(health.status).toBe(200);

    const login = await createApp().request("/api/auth/login", { redirect: "manual" });
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("/");
    expect(login.headers.get("set-cookie")).toContain("alfred_session=dev-session-token");
  });

  it("uses the cloud auth callback path when starting OIDC through the api alias", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          authorization_endpoint: "https://idp.example.test/authorize",
          token_endpoint: "https://idp.example.test/token",
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const app = new Hono();
    app.route(
      "/api/auth",
      createAuthRoutes(dbMock as never, {
        callbackPath: "/api/auth/callback",
        config: {
          appBaseUrl: "https://alfred.example.test",
          bootstrapWorkspaceId: "00000000-0000-4000-8000-000000000001",
          clientId: "alfred-client",
          clientSecret: "alfred-secret",
          issuer: "https://idp.example.test",
        },
      }),
    );

    try {
      const login = await app.request("/api/auth/login", { redirect: "manual" });
      const location = login.headers.get("location");

      expect(login.status).toBe(302);
      expect(location).toContain(
        "redirect_uri=https%3A%2F%2Falfred.example.test%2Fapi%2Fauth%2Fcallback",
      );
      expect(new URL(location ?? "").searchParams.get("redirect_uri")).toBe(
        "https://alfred.example.test/api/auth/callback",
      );
    } finally {
      fetchMock.mockRestore();
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
