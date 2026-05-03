import type { SystemStatus } from "./system-api-client";

export type SystemStatusSnapshot = SystemStatus | null | { kind: "unavailable" };

export type SystemStatusVM = {
  tone: "live" | "quiet" | "offline";
  label: string;
  detail: string;
};

export function buildSystemStatusVM(status: SystemStatusSnapshot): SystemStatusVM {
  if (!status) {
    return { tone: "offline", label: "Runner unknown", detail: "No heartbeat yet" };
  }

  if ("kind" in status) {
    return {
      tone: "offline",
      label: "Runner status unavailable",
      detail: "I can't check freshness right now",
    };
  }

  const state = status.runner.state;
  if (state === "live") {
    return {
      tone: "live",
      label: "Runner live",
      detail: status.runner.seconds_since_last_ingest === null
        ? `Heartbeat ${elapsed(status.runner.seconds_since_last_device_seen)} ago; no ingest yet`
        : `Last ingest ${elapsed(status.runner.seconds_since_last_ingest)} ago`,
    };
  }

  if (state === "quiet") {
    return {
      tone: "quiet",
      label: "Runner quiet",
      detail: status.runner.seconds_since_last_ingest === null
        ? `Last heartbeat ${elapsed(status.runner.seconds_since_last_device_seen)} ago; no ingest yet`
        : `Last ingest ${elapsed(status.runner.seconds_since_last_ingest)} ago`,
    };
  }

  return { tone: "offline", label: "Runner offline", detail: "Only archived runs may be visible" };
}

function elapsed(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "unknown";
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}
