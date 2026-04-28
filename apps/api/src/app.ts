import { Hono } from "hono";
import { healthRoutes } from "./routes/health";
import { createIngestRoutes } from "./routes/ingest";
import { createRunsRoutes } from "./routes/runs";

export function createApp() {
  const app = new Hono();
  app.route("/health", healthRoutes);
  app.route("/v1/ingest", createIngestRoutes());
  app.route("/v1/runs", createRunsRoutes());
  return app;
}
