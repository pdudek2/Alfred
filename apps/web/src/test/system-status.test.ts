import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { SystemStatus } from "../components/system-status";
import { getSystemStatus } from "../lib/system-api-client";
import { buildSystemStatusVM } from "../lib/system-status-view-model";

describe("system status API client", () => {
  it("loads system status with session credentials", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          runner: {
            state: "live",
            seconds_since_last_device_seen: 8,
            seconds_since_last_ingest: 8,
            last_device_seen_at: "2026-04-30T12:00:00.000Z",
            last_ingest_at: "2026-04-30T12:00:00.000Z",
            latest_run_updated_at: "2026-04-30T12:00:00.000Z",
          },
        }),
        { status: 200 },
      );
    });

    await expect(getSystemStatus(fetchImpl)).resolves.toMatchObject({
      runner: { state: "live", seconds_since_last_device_seen: 8, seconds_since_last_ingest: 8 },
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/system/status", { credentials: "include" });
  });

  it("throws when the status endpoint fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));

    await expect(getSystemStatus(fetchImpl)).rejects.toThrow("System status failed: 503");
  });
});

describe("system status view model", () => {
  it("speaks clearly when runner is live", () => {
    expect(
      buildSystemStatusVM({
        runner: {
          state: "live",
          seconds_since_last_device_seen: 8,
          seconds_since_last_ingest: 8,
          last_device_seen_at: "2026-04-30T12:00:00.000Z",
          last_ingest_at: "2026-04-30T12:00:00.000Z",
          latest_run_updated_at: "2026-04-30T12:00:00.000Z",
        },
      }),
    ).toMatchObject({
      tone: "live",
      label: "Runner live",
      detail: "Last ingest 8s ago",
    });
  });

  it("does not call a quiet runner live", () => {
    expect(
      buildSystemStatusVM({
        runner: {
          state: "quiet",
          seconds_since_last_device_seen: 720,
          seconds_since_last_ingest: 720,
          last_device_seen_at: "2026-04-30T11:48:00.000Z",
          last_ingest_at: "2026-04-30T11:48:00.000Z",
          latest_run_updated_at: "2026-04-30T11:48:00.000Z",
        },
      }),
    ).toMatchObject({
      tone: "quiet",
      label: "Runner quiet",
      detail: "Last ingest 12m ago",
    });
  });

  it("shows heartbeat freshness when no ingest has happened yet", () => {
    expect(
      buildSystemStatusVM({
        runner: {
          state: "live",
          seconds_since_last_device_seen: 8,
          seconds_since_last_ingest: null,
          last_device_seen_at: "2026-04-30T12:00:00.000Z",
          last_ingest_at: null,
          latest_run_updated_at: null,
        },
      }),
    ).toMatchObject({
      tone: "live",
      label: "Runner live",
      detail: "Heartbeat 8s ago; no ingest yet",
    });
  });

  it("shows an archived-only note when the runner is offline", () => {
    expect(
      buildSystemStatusVM({
        runner: {
          state: "offline",
          seconds_since_last_device_seen: null,
          seconds_since_last_ingest: null,
          last_device_seen_at: null,
          last_ingest_at: null,
          latest_run_updated_at: null,
        },
      }),
    ).toEqual({
      tone: "offline",
      label: "Runner offline",
      detail: "Only archived runs may be visible",
    });
  });

  it("keeps missing status unknown instead of fatal", () => {
    expect(buildSystemStatusVM(null)).toEqual({
      tone: "offline",
      label: "Runner unknown",
      detail: "No heartbeat yet",
    });
  });

  it("does not describe a failed status request as missing heartbeat data", () => {
    expect(buildSystemStatusVM({ kind: "unavailable" })).toEqual({
      tone: "offline",
      label: "Runner status unavailable",
      detail: "I can't check freshness right now",
    });
  });
});

describe("SystemStatus", () => {
  it("announces status changes politely", () => {
    render(
      createElement(SystemStatus, {
        vm: { tone: "live", label: "Runner live", detail: "Last ingest 8s ago" },
      }),
    );

    expect(screen.getByText("Runner live").closest(".system-status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Runner live").closest(".system-status")).toHaveClass("system-status--live");
  });
});
