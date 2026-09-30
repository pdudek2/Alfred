import { presentActivityEvents } from "./activity-presentation";
import type { AttentionProjection } from "./attention-projection";
import { isReviewableWorktreeSession } from "./session-scope";
import { sessionState, type SessionDisplayStatus } from "./session-status";
import type { SessionTile } from "./session-state";

export type AgentHandoffDetail = {
  activity: Array<{ id: string; title: string; detail: string }>;
  branchName?: string;
  canReviewDiff: boolean;
  decision?: string;
  outcome: string;
  sessionId: string;
  sessionTitle: string;
  stateLabel: string;
  stateTone: "attention" | "danger" | "ready" | "working";
  workspaceId: string;
  workspaceLabel: string;
};

export function buildAgentHandoffDetail(
  item: AttentionProjection,
  session: SessionTile,
): AgentHandoffDetail {
  const status = sessionState(session);
  const activity = presentActivityEvents(session.activityEvents ?? [], { limit: 3 }).visibleEvents
    .map(({ id, title, detail }) => ({ id, title, detail }));

  return {
    activity,
    ...(session.branchName === undefined ? {} : { branchName: session.branchName }),
    canReviewDiff: isReviewableWorktreeSession(session),
    ...(item.blocksAgent ? { decision: item.reason } : {}),
    outcome: activity[0]?.detail ?? item.reason,
    sessionId: item.sessionId,
    sessionTitle: item.sessionTitle,
    stateLabel: status.label[0]!.toUpperCase() + status.label.slice(1),
    stateTone: handoffStateTone(status),
    workspaceId: item.workspaceId,
    workspaceLabel: item.workspaceLabel,
  };
}

export function recentHandoffItems(items: readonly AttentionProjection[]): AttentionProjection[] {
  return items
    .filter((item) => item.section === "recovery")
    .sort((left, right) => right.attentionAt - left.attentionAt)
    .slice(0, 5);
}

function handoffStateTone(status: SessionDisplayStatus): AgentHandoffDetail["stateTone"] {
  switch (status.kind) {
    case "needs-you":
      return status.reason === "approval" ? "attention" : "danger";
    case "your-turn":
      return "attention";
    case "failed":
      return "danger";
    case "done":
    case "asleep":
    case "draft":
      return "ready";
    case "working":
    case "running":
    case "idle":
    case "unavailable":
      return "working";
  }
}
