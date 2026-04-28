import { Hono } from "hono";
import { healthRoutes } from "./routes/health";
import { createIngestRoutes } from "./routes/ingest";

export function createApp() {
  const app = new Hono();
  app.route("/health", healthRoutes);
  app.route("/v1/ingest", createIngestRoutes());
  return app;
}
