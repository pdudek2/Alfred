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
      detail: attentionDetailForSession(session, status.kind),
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
        detail: attentionDetailForSession(session, status.kind),
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

function attentionDetailForSession(session: SessionTile, kind: SessionDisplayStatus["kind"]): string {
  if (kind === "waiting") {
    const approval = latestActivityOfKind(session, "approval");
    return (
      truncateReason(approval?.payload?.type === "approval" ? approval.payload.prompt : approval?.detail) ??
      attentionDetail(kind)
    );
  }

  if (kind === "error") {
    const error = latestActivityOfKind(session, "error");
    return (
      truncateReason(error?.payload?.type === "error" ? error.payload.message : error?.detail) ??
      attentionDetail(kind)
    );
  }

  if (kind === "blocked") {
    return truncateReason(session.safetyNote ?? commandLabel(session)) ?? attentionDetail(kind);
  }

  if (kind === "staged") {
    return truncateReason(commandLabel(session)) ?? attentionDetail(kind);
  }

  if (kind === "restored") {
    const latest = session.activityEvents?.at(-1);
    return truncateReason(latest ? `${latest.title}: ${latest.detail}` : undefined) ?? attentionDetail(kind);
  }

  return attentionDetail(kind);
}

function latestActivityOfKind(
  session: SessionTile,
  kind: NonNullable<SessionTile["activityEvents"]>[number]["kind"],
): NonNullable<SessionTile["activityEvents"]>[number] | null {
  const events = session.activityEvents ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === kind) return event;
  }

  return null;
}

function commandLabel(session: SessionTile): string | undefined {
  const command = session.command?.trim();
  if (!command) return undefined;
  return [command, ...(session.args ?? [])].join(" ");
}

function truncateReason(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const normalized = value.trim();
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}
