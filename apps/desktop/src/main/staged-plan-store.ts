import type {
  AlfredStagedPlanResolveRequest,
  AlfredStagedPlanSetRequest,
  AlfredStagedPlanSnapshot,
  AlfredStagedPlanSnapshotResponse,
} from "../shared/alfred-ipc.js";

let stagedPlan: AlfredStagedPlanSnapshot | null = null;

export function getStagedPlanSnapshot(): AlfredStagedPlanSnapshotResponse {
  return { plan: clonePlan(stagedPlan) };
}

export function setStagedPlanSnapshot(request: AlfredStagedPlanSetRequest): AlfredStagedPlanSnapshotResponse {
  stagedPlan = clonePlan(request);
  return getStagedPlanSnapshot();
}

export function resolveStagedPlanSessions(
  request: AlfredStagedPlanResolveRequest,
): AlfredStagedPlanSnapshotResponse {
  if (!stagedPlan || request.sessionIds.length === 0) {
    return getStagedPlanSnapshot();
  }

  const resolved = new Set(request.sessionIds);
  const remainingSessions = stagedPlan.sessions.filter((session) => !resolved.has(session.id));
  stagedPlan = remainingSessions.length === 0 ? null : { ...stagedPlan, sessions: remainingSessions };
  return getStagedPlanSnapshot();
}

export function clearStagedPlanSnapshot(): AlfredStagedPlanSnapshotResponse {
  stagedPlan = null;
  return getStagedPlanSnapshot();
}

function clonePlan(plan: AlfredStagedPlanSnapshot | null): AlfredStagedPlanSnapshot | null {
  if (!plan) return null;
  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({ ...session, args: [...session.args] })),
  };
}
