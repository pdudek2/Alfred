import type { SessionDisplayStatus } from "./session-status";
import { terminalSessionDisplayStatus } from "./session-status";
import type { SessionTile } from "./session-state";

export type WorkspaceAttention = {
  session: SessionTile;
  status: SessionDisplayStatus;
  detail: string;
};

export type WorkspaceReviewItem = WorkspaceAttention & {
  id: string;
  priority: number;
  workspaceId: string;
  workspaceLabel: string;
  workspaceShortLabel: string;
};

type WorkspaceReviewScope = {
  id: string;
  label: string;
  shortLabel: string;
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

export function workspaceReviewQueue(
  workspaces: WorkspaceReviewScope[],
  sessions: SessionTile[],
  now = Date.now(),
): WorkspaceReviewItem[] {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

  return sessions
    .flatMap((session): WorkspaceReviewItem[] => {
      const status = terminalSessionDisplayStatus(session, "ready", now);
      const priority = ATTENTION_PRIORITY[status.kind];
      if (priority === undefined) return [];

      const workspace = workspacesById.get(session.workspaceId);
      return [{
        id: `${session.workspaceId}:${session.id}`,
        priority,
        session,
        status,
        detail: attentionDetail(status.kind),
        workspaceId: session.workspaceId,
        workspaceLabel: workspace?.label ?? session.workspaceId,
        workspaceShortLabel: workspace?.shortLabel ?? session.workspaceId,
      }];
    })
    .sort(compareReviewItems);
}

function compareReviewItems(a: WorkspaceReviewItem, b: WorkspaceReviewItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;

  const aTime = a.session.lastActivityAt ?? a.session.lastOutputAt ?? a.session.createdAt ?? 0;
  const bTime = b.session.lastActivityAt ?? b.session.lastOutputAt ?? b.session.createdAt ?? 0;
  if (aTime !== bTime) return bTime - aTime;

  const workspace = a.workspaceLabel.localeCompare(b.workspaceLabel);
  if (workspace !== 0) return workspace;

  return a.session.title.localeCompare(b.session.title);
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
