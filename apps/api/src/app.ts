import { Hono } from "hono";
import { healthRoutes } from "./routes/health";
import { createIngestRoutes } from "./routes/ingest";
import { createRunsRoutes } from "./routes/runs";

export function createApp() {
  const app = new Hono();
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
  app.route("/health", healthRoutes);
  app.route("/v1/ingest", createIngestRoutes());
  app.route("/v1/runs", createRunsRoutes());
  app.route("/api/v1/ingest", createIngestRoutes());
  app.route("/api/v1/runs", createRunsRoutes());
  return app;
}
