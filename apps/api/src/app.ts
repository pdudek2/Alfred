import { Hono } from "hono";
import { createDb } from "@alfred/db";
import { seedBootstrapAuth } from "./auth/bootstrap-auth.js";
import {
  createDbDeviceAuthStore,
  createFallbackDeviceAuthStore,
  createStaticDeviceAuthStore,
} from "./auth/device-auth.js";
import { env } from "./env.js";
import { healthRoutes } from "./routes/health.js";
import { createIngestRoutes } from "./routes/ingest.js";

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
  const dbDeviceAuthStore = createDbDeviceAuthStore(db);
  const deviceAuthStore = env.DEV_AUTH_ENABLED
    ? createFallbackDeviceAuthStore(
        dbDeviceAuthStore,
        createStaticDeviceAuthStore(env.RUNNER_DEVICE_TOKEN, env.RUNNER_WORKSPACE_ID, env.RUNNER_DEVICE_ID),
        process.env.NODE_ENV === "test",
      )
    : dbDeviceAuthStore;

  app.get("/", (c) =>
    c.json({
      ok: true,
      service: "alfred-api",
      endpoints: {
        health: "/health",
        heartbeat: "/v1/ingest/heartbeat",
        batches: "/v1/ingest/batches",
      },
    }),
  );

  app.route("/health", healthRoutes);
  app.route("/api/health", healthRoutes);
  for (const prefix of ["/v1", "/api/v1"]) {
    app.use(`${prefix}/ingest/*`, async (_c, next) => {
      await ensureBootstrapAuth();
      await next();
    });
    app.route(`${prefix}/ingest`, createIngestRoutes(db, deviceAuthStore));
  }
  return app;
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
