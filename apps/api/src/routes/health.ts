import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => {
  return c.json({
    ok: true,
    service: "alfred-api",
    version: "0.0.0",
  });
});
