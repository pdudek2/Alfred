import type { SessionTile } from "./session-state";

export type RecoveryCounts = {
  ended: number;
  failed: number;
  saved: number;
  total: number;
};

export function recoveryCounts(sessions: SessionTile[]): RecoveryCounts {
  return sessions.reduce<RecoveryCounts>(
    (counts, session) => {
      counts.total += 1;
      if (session.runtimeStatus === "error") {
        counts.failed += 1;
      } else if (session.runtimeStatus === "restored") {
        counts.saved += 1;
      } else {
        counts.ended += 1;
      }
      return counts;
    },
    { ended: 0, failed: 0, saved: 0, total: 0 },
  );
}

export function recoveryHeadline(sessions: SessionTile[]): string {
  const counts = recoveryCounts(sessions);
  if (counts.total === 0) return "No recovery items";
  if (counts.saved === counts.total) return `${counts.total} saved session${counts.total === 1 ? "" : "s"} ready`;
  if (counts.failed === counts.total) {
    return `${counts.total} failed session${counts.total === 1 ? "" : "s"} need${counts.total === 1 ? "s" : ""} restart`;
  }
  if (counts.ended === counts.total) {
    return `${counts.total} ended session${counts.total === 1 ? "" : "s"} ready to restart`;
  }
  return `${counts.total} recovery item${counts.total === 1 ? "" : "s"} ready`;
}

export function recoverySummary(sessions: SessionTile[]): string {
  const counts = recoveryCounts(sessions);
  return [
    counts.saved > 0 ? `${counts.saved} saved` : null,
    counts.ended > 0 ? `${counts.ended} ended` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
  ].filter((item): item is string => item !== null).join(" · ");
}

export function recoveryStatusLabel(session: SessionTile): "done" | "error" | "restored" {
  if (session.runtimeStatus === "error") return "error";
  if (session.runtimeStatus === "restored") return "restored";
  return "done";
}
