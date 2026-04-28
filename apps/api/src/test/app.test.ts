import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireDeviceToken } from "../auth/device-auth";
import { createApp } from "../app";

describe("api", () => {
  it("returns health", async () => {
    const res = await createApp().request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      service: "alfred-api",
      version: "0.0.0",
    });
  });

  it("rejects missing device token", async () => {
    const app = new Hono();
    app.use("/private/*", requireDeviceToken("secret"));
    app.get("/private/ping", (c) => c.json({ ok: true }));

    const res = await app.request("/private/ping");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("allows valid device token", async () => {
    const app = new Hono();
    app.use("/private/*", requireDeviceToken("secret"));
    app.get("/private/ping", (c) => c.json({ ok: true }));

    const res = await app.request("/private/ping", {
      headers: { Authorization: "Bearer secret" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
