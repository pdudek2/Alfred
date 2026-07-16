import { formatCommand } from "./command-display";
import { sessionRelaunchSafety } from "./relaunch-safety";
import { terminalSessionDisplayStatus, type SessionDisplayStatus } from "./session-status";
import { isLaunchBlocked, type SessionTile } from "./session-state";
import { checkSafety } from "../shared/terminal-command-safety";

export type AttentionKind =
  | "agent-waiting"
  | "staged-launch"
  | "blocked-safety"
  | "recovery";

export type AttentionProvenance = "structured" | "inferred" | "runtime";

export type AttentionAction =
  | { kind: "open-in-work" }
  | { kind: "launch" }
  | { kind: "review-edit" }
  | { kind: "resume" }
  | { kind: "relaunch"; confirmation: "none" | "required" };

export type AttentionProjection = {
  id: string;
  workspaceId: string;
  workspaceLabel: string;
  sessionId: string;
  sessionTitle: string;
  kind: AttentionKind;
  section: "needs-you" | "recovery";
  blocksAgent: boolean;
  rank: 0 | 1 | 2 | null;
  attentionAt: number | undefined;
  reason: string;
  provenance: AttentionProvenance;
  command?: string;
  action: AttentionAction;
};

type AttentionWorkspace = {
  id: string;
  label: string;
};

export function buildAttentionProjection(
  workspaces: AttentionWorkspace[],
  sessions: SessionTile[],
  now = Date.now(),
): AttentionProjection[] {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));

  const projected = sessions.flatMap((session): AttentionProjection[] => {
    const workspace = workspacesById.get(session.workspaceId) ?? {
      id: session.workspaceId,
      label: session.workspaceId,
    };
    const status = terminalSessionDisplayStatus(session, "ready", now);
    if (status.kind === "checking") return [];

    const projection =
      projectBlockedSafety(session, workspace, status) ??
      projectAgentWaiting(session, workspace, status) ??
      projectStagedLaunch(session, workspace, status) ??
      projectRecovery(session, workspace, status);

    return projection ? [projection] : [];
  });
  const uniqueById = new Map<string, AttentionProjection>();
  for (const item of projected) {
    const existing = uniqueById.get(item.id);
    if (!existing || compareDuplicateAttention(item, existing) < 0) {
      uniqueById.set(item.id, item);
    }
  }

  return [...uniqueById.values()].sort(compareAttention);
}

export function blockingAttentionCount(items: readonly AttentionProjection[]): number {
  return items.reduce((count, item) => count + Number(item.blocksAgent), 0);
}

export function blockingAttentionCountByWorkspace(
  items: readonly AttentionProjection[],
): ReadonlyMap<string, number> {
  return items.reduce((counts, item) => {
    if (item.blocksAgent) {
      counts.set(item.workspaceId, (counts.get(item.workspaceId) ?? 0) + 1);
    }
    return counts;
  }, new Map<string, number>());
}

function projectBlockedSafety(
  session: SessionTile,
  workspace: AttentionWorkspace,
  status: SessionDisplayStatus,
): AttentionProjection | null {
  if (status.kind !== "blocked" || session.stage !== "staged" || !isLaunchBlocked(session)) return null;

  const reason = session.safetyNote?.trim()
    || (session.launchPreflight?.status === "blocked" ? session.launchPreflight.reason : "Launch needs safety review.");

  return {
    ...projectionIdentity(session, workspace),
    kind: "blocked-safety",
    section: "needs-you",
    blocksAgent: true,
    rank: 0,
    attentionAt: fallbackAttentionAt(session),
    reason,
    provenance: "runtime",
    ...projectionCommand(session),
    action: { kind: "review-edit" },
  };
}

function projectAgentWaiting(
  session: SessionTile,
  workspace: AttentionWorkspace,
  status: SessionDisplayStatus,
): AttentionProjection | null {
  if (status.kind !== "waiting") return null;
  const approval = session.activityEvents?.at(-1);
  if (approval?.kind !== "approval") return null;

  const reason = approval.payload?.type === "approval" ? approval.payload.prompt : approval.detail;

  return {
    ...projectionIdentity(session, workspace),
    kind: "agent-waiting",
    section: "needs-you",
    blocksAgent: true,
    rank: 1,
    attentionAt: approval.at,
    reason,
    provenance: "inferred",
    ...projectionCommand(session),
    action: { kind: "open-in-work" },
  };
}

function projectStagedLaunch(
  session: SessionTile,
  workspace: AttentionWorkspace,
  status: SessionDisplayStatus,
): AttentionProjection | null {
  if (status.kind !== "staged" || !session.command?.trim()) return null;
  const command = formatCommand(session);

  return {
    ...projectionIdentity(session, workspace),
    kind: "staged-launch",
    section: "needs-you",
    blocksAgent: true,
    rank: 2,
    attentionAt: fallbackAttentionAt(session),
    reason: command,
    provenance: "structured",
    command,
    action: { kind: "launch" },
  };
}

function projectRecovery(
  session: SessionTile,
  workspace: AttentionWorkspace,
  status: SessionDisplayStatus,
): AttentionProjection | null {
  if (status.kind !== "restored" && status.kind !== "done" && status.kind !== "error") return null;

  const resumable = status.kind === "restored" && isResumableAgent(session);
  if (!resumable && !session.command?.trim()) return null;
  if (!resumable && checkSafety(session.command!, session.args ?? []).unsafe) return null;

  const safety = sessionRelaunchSafety(session);
  const action: AttentionAction = resumable
    ? { kind: "resume" }
    : { kind: "relaunch", confirmation: safety.safe ? "none" : "required" };
  const reason = !safety.safe
    ? safety.reason
    : resumable
      ? "Saved agent session can be resumed."
      : status.kind === "restored"
        ? "Saved session can be relaunched."
        : "Ended session can be relaunched.";

  return {
    ...projectionIdentity(session, workspace),
    kind: "recovery",
    section: "recovery",
    blocksAgent: false,
    rank: null,
    attentionAt: fallbackAttentionAt(session),
    reason,
    provenance: "runtime",
    ...projectionCommand(session),
    action,
  };
}

function projectionIdentity(
  session: SessionTile,
  workspace: AttentionWorkspace,
): Pick<AttentionProjection, "id" | "sessionId" | "sessionTitle" | "workspaceId" | "workspaceLabel"> {
  return {
    id: `${session.workspaceId}:${session.id}`,
    workspaceId: session.workspaceId,
    workspaceLabel: workspace.label,
    sessionId: session.id,
    sessionTitle: session.title,
  };
}

function projectionCommand(session: SessionTile): Pick<AttentionProjection, "command"> | Record<string, never> {
  return session.command?.trim() ? { command: formatCommand(session) } : {};
}

function fallbackAttentionAt(session: SessionTile): number | undefined {
  return session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt;
}

function isResumableAgent(session: SessionTile): boolean {
  return session.agentKind === "codex"
    || session.agentKind === "claude"
    || session.command === "codex"
    || session.command === "claude";
}

function compareAttention(a: AttentionProjection, b: AttentionProjection): number {
  if (a.section !== b.section) return a.section === "needs-you" ? -1 : 1;
  if (a.rank !== b.rank) return (a.rank ?? 3) - (b.rank ?? 3);
  if (a.attentionAt !== b.attentionAt) {
    if (a.attentionAt === undefined) return 1;
    if (b.attentionAt === undefined) return -1;
    return a.attentionAt - b.attentionAt;
  }
  return a.workspaceLabel.localeCompare(b.workspaceLabel)
    || a.sessionTitle.localeCompare(b.sessionTitle)
    || a.id.localeCompare(b.id);
}

function compareDuplicateAttention(a: AttentionProjection, b: AttentionProjection): number {
  return compareAttention(a, b)
    || duplicateTieBreaker(a).localeCompare(duplicateTieBreaker(b));
}

function duplicateTieBreaker(item: AttentionProjection): string {
  return [
    item.kind,
    item.provenance,
    item.reason,
    item.command ?? "",
    JSON.stringify(item.action),
  ].join("\u0000");
}
