import type { SessionDisplayStatus } from "./session-status";
import { terminalSessionDisplayStatus } from "./session-status";
import type { SessionTile } from "./session-state";

export type WorkspaceAttention = {
  session: SessionTile;
  status: SessionDisplayStatus;
  detail: string;
};

const ATTENTION_PRIORITY: Partial<Record<SessionDisplayStatus["kind"], number>> = {
  error: 0,
  waiting: 1,
  blocked: 2,
  staged: 3,
  restored: 4,
};

export function workspaceAttention(sessions: SessionTile[], now = Date.now()): WorkspaceAttention | null {
  let best: WorkspaceAttention | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (const session of sessions) {
    const status = terminalSessionDisplayStatus(session, "ready", now);
    const priority = ATTENTION_PRIORITY[status.kind];
    if (priority === undefined || priority >= bestPriority) continue;

    bestPriority = priority;
    best = {
      session,
      status,
      detail: attentionDetail(status.kind),
    };
  }

  return best;
}

function attentionDetail(kind: SessionDisplayStatus["kind"]): string {
  switch (kind) {
    case "error":
      return "needs a restart or closer look";
    case "waiting":
      return "is waiting on you";
    case "blocked":
      return "has a flagged launch command";
    case "staged":
      return "is ready to launch";
    case "restored":
      return "can be relaunched";
    default:
      return "needs review";
  }
}
