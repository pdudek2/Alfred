import { presentActivityEvents } from "./activity-presentation";
import type { AttentionProjection } from "./attention-projection";
import { isReviewableWorktreeSession } from "./session-scope";
import { terminalSessionDisplayStatus } from "./session-status";
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
  const status = terminalSessionDisplayStatus(session);
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
    stateTone: handoffStateTone(status.kind),
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

function handoffStateTone(
  status: ReturnType<typeof terminalSessionDisplayStatus>["kind"],
): AgentHandoffDetail["stateTone"] {
  switch (status) {
    case "waiting":
      return "attention";
    case "blocked":
    case "error":
      return "danger";
    case "done":
    case "restored":
    case "staged":
      return "ready";
    default:
      return "working";
  }
}
