import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient } from "../lib/api-client";
import { formatDateTime, formatDuration } from "../lib/time";

describe("api client", () => {
  it("loads runs through the proxy path", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: "run-1" }] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const runs = await createApiClient(fetchImpl).listRuns(5);

    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/runs?limit=5");
    expect(runs).toEqual([{ id: "run-1" }]);
  });

  it("serializes selected run filters into the list query string", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as unknown as
      typeof fetch;

    await createApiClient(fetchImpl).listRuns({
      limit: 10,
      filters: {
        source: "codex-cli",
        status: "running",
        project: "Alfred Labs",
        since: "2026-04-28",
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/runs?limit=10&source=codex-cli&status=running&project=Alfred+Labs&since=2026-04-28",
    );
  });

  it("throws on failed run list request", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;

    await expect(createApiClient(fetchImpl).listRuns()).rejects.toThrow("Failed to load runs: 500");
  });

  it("throws a typed auth error on unauthorized requests", async () => {
    const fetchImpl = vi.fn(async () => new Response("login", { status: 401 })) as unknown as typeof fetch;

    await expect(createApiClient(fetchImpl).listRuns()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "unauthorized",
    });
    expect(new ApiError("Nope", 401).code).toBe("unauthorized");
  });

  it("treats forbidden responses as auth failures", () => {
    expect(new ApiError("Forbidden", 403).code).toBe("unauthorized");
  });

  it("loads run details", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "run-1", events: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const run = await createApiClient(fetchImpl).getRun("run-1");

    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/runs/run-1");
    expect(run).toEqual({ id: "run-1", events: [] });
  });
});

describe("time formatting", () => {
  it("formats missing values", () => {
    expect(formatDateTime(null)).toBe("not set");
    expect(formatDuration(null, null)).toBe("open");
  });

  it("formats duration", () => {
    expect(formatDuration("2026-04-28T10:00:00.000Z", "2026-04-28T10:45:00.000Z")).toBe("45m");
  });
});
