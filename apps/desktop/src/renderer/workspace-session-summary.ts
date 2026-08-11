import { terminalSessionDisplayStatus, type SessionDisplayStatus } from "./session-status";
import type { SessionTile } from "./session-state";

const STATUS_ORDER = ["error", "waiting", "blocked", "runtime", "active", "starting", "done", "restored", "staged", "checking", "idle"] as const;

export function workspaceSessionSummary(sessions: SessionTile[], now = Date.now()): string {
  if (sessions.length === 0) return "empty";

  const counts = new Map<SessionDisplayStatus["kind"], { count: number; label: SessionDisplayStatus["label"] }>();
  for (const session of sessions) {
    const status = terminalSessionDisplayStatus(session, "ready", now);
    const current = counts.get(status.kind);
    counts.set(status.kind, { count: (current?.count ?? 0) + 1, label: status.label });
  }

  return STATUS_ORDER.flatMap((status) => {
    const current = counts.get(status);
    return current ? [`${current.count} ${current.label}`] : [];
  }).join(" · ");
}
