import { terminalSessionDisplayStatus } from "./session-status";
import type { SessionTile } from "./session-state";

const STATUS_ORDER = ["error", "waiting", "blocked", "runtime", "active", "starting", "done", "restored", "staged", "idle"] as const;

export function workspaceSessionSummary(sessions: SessionTile[], now = Date.now()): string {
  if (sessions.length === 0) return "empty";

  const counts = new Map<string, number>();
  for (const session of sessions) {
    const status = terminalSessionDisplayStatus(session, "ready", now).kind;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return STATUS_ORDER.flatMap((status) => {
    const count = counts.get(status) ?? 0;
    return count > 0 ? [`${count} ${statusLabel(status)}`] : [];
  }).join(" · ");
}

function statusLabel(status: (typeof STATUS_ORDER)[number]): string {
  switch (status) {
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "error":
      return "error";
    case "restored":
      return "restored";
    case "runtime":
      return "unavailable";
    case "staged":
      return "ready";
    case "starting":
      return "starting";
    case "waiting":
      return "waiting";
    case "active":
      return "active";
    case "idle":
      return "idle";
  }
}
