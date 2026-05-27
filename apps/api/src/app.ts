import { Hono } from "hono";
import { createDb } from "@alfred/db";
import { seedBootstrapAuth } from "./auth/bootstrap-auth.js";
import {
  createDbDeviceAuthStore,
  createFallbackDeviceAuthStore,
  createStaticDeviceAuthStore,
} from "./auth/device-auth.js";
import {
  createDbSessionStore,
  createFallbackSessionStore,
  createStaticSessionStore,
} from "./auth/session-auth.js";
import { env } from "./env.js";
import { createAuthRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { createIngestRoutes } from "./routes/ingest.js";
import { createRunsRoutes } from "./routes/runs.js";
import { createSystemRoutes } from "./routes/system.js";
import { createSystemStatusStore } from "./services/system-status-store.js";

export function createApp() {
  const app = new Hono();
  const db = createDb();
  const bootstrapAuth =
    process.env.NODE_ENV === "test"
      ? async () => undefined
      : () =>
          seedBootstrapAuth(db, {
            adminEmail: env.ALFRED_BOOTSTRAP_ADMIN_EMAIL,
            deviceId: env.RUNNER_DEVICE_ID,
            deviceToken: env.RUNNER_DEVICE_TOKEN,
            userId: env.ALFRED_BOOTSTRAP_USER_ID,
            workspaceId: env.ALFRED_BOOTSTRAP_WORKSPACE_ID,
          });
  const ensureBootstrapAuth = createBootstrapAuthGate(bootstrapAuth);
  const staticSessionStore = createStaticSessionStore(env.AUTH_DEV_SESSION_TOKEN, {
    userId: env.ALFRED_BOOTSTRAP_USER_ID,
    email: env.ALFRED_BOOTSTRAP_ADMIN_EMAIL,
    workspaceId: env.ALFRED_BOOTSTRAP_WORKSPACE_ID,
  });
  const dbSessionStore = createDbSessionStore(db);
  const dbDeviceAuthStore = createDbDeviceAuthStore(db);
  const systemStatusStore = createSystemStatusStore(db);
  const sessionStore = env.DEV_AUTH_ENABLED
    ? createFallbackSessionStore(dbSessionStore, staticSessionStore, process.env.NODE_ENV === "test")
    : dbSessionStore;
  const deviceAuthStore = env.DEV_AUTH_ENABLED
    ? createFallbackDeviceAuthStore(
        dbDeviceAuthStore,
        createStaticDeviceAuthStore(env.RUNNER_DEVICE_TOKEN, env.RUNNER_WORKSPACE_ID, env.RUNNER_DEVICE_ID),
        process.env.NODE_ENV === "test",
      )
    : dbDeviceAuthStore;

  app.use("*", async (c, next) => {
    if (isLivenessPath(c.req.path)) {
      await next();
      return;
    }

    await ensureBootstrapAuth();
    await next();
  });

  app.get("/", (c) =>
    c.json({
      ok: true,
      service: "alfred-api",
      endpoints: {
        health: "/health",
        runs: "/v1/runs",
        webPrefixedRuns: "/api/v1/runs",
      },
    }),
  );
  const authRouteOptions = {
    config: {
      appBaseUrl: env.APP_BASE_URL,
      bootstrapWorkspaceId: env.ALFRED_BOOTSTRAP_WORKSPACE_ID,
      ...(env.AUTH_OIDC_CLIENT_ID ? { clientId: env.AUTH_OIDC_CLIENT_ID } : {}),
      ...(env.AUTH_OIDC_CLIENT_SECRET ? { clientSecret: env.AUTH_OIDC_CLIENT_SECRET } : {}),
      ...(env.AUTH_OIDC_ISSUER ? { issuer: env.AUTH_OIDC_ISSUER } : {}),
    },
    devAuth: {
      enabled: env.DEV_AUTH_ENABLED,
      sessionToken: env.AUTH_DEV_SESSION_TOKEN,
    },
  };

  app.route("/health", healthRoutes);
  app.route("/api/health", healthRoutes);
  app.route("/auth", createAuthRoutes(db, authRouteOptions));
  app.route("/api/auth", createAuthRoutes(db, { ...authRouteOptions, callbackPath: "/api/auth/callback" }));
  mountVersionedApiRoutes("/v1");
  mountVersionedApiRoutes("/api/v1");
  return app;

  function mountVersionedApiRoutes(prefix: string) {
    app.route(`${prefix}/ingest`, createIngestRoutes(db, deviceAuthStore));
    app.route(`${prefix}/runs`, createRunsRoutes(db, { sessionStore }));
    app.route(`${prefix}/system`, createSystemRoutes(systemStatusStore, sessionStore));
  }
}

function createBootstrapAuthGate(bootstrapAuth: () => Promise<void>) {
  let ready = false;
  let pending: Promise<void> | undefined;

  return async () => {
    if (ready) return;
    pending ??= bootstrapAuth()
      .then(() => {
        ready = true;
      })
      .catch((error) => {
        pending = undefined;
        throw error;
      });
    await pending;
  };
}

function isLivenessPath(path: string): boolean {
  return path === "/health" || path === "/api/health";
}
