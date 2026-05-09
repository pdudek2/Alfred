import type {
  AlfredStagedPlanResolveRequest,
  AlfredStagedPlanSetRequest,
  AlfredStagedPlanSnapshot,
  AlfredStagedPlanSnapshotResponse,
} from "../shared/alfred-ipc.js";
import type { PersistedDesktopStateStore } from "./persisted-desktop-state.js";

let stagedPlan: AlfredStagedPlanSnapshot | null = null;
let persistedStateStore: PersistedDesktopStateStore | null = null;

export function configureStagedPlanPersistence(store: PersistedDesktopStateStore): void {
  persistedStateStore = store;
  stagedPlan = null;
}

export async function getStagedPlanSnapshot(): Promise<AlfredStagedPlanSnapshotResponse> {
  if (persistedStateStore) {
    return { plan: clonePlan((await persistedStateStore.getState()).stagedPlan) };
  }

  return { plan: clonePlan(stagedPlan) };
}

export async function setStagedPlanSnapshot(
  request: AlfredStagedPlanSetRequest,
): Promise<AlfredStagedPlanSnapshotResponse> {
  if (persistedStateStore) {
    const next = await persistedStateStore.updateState((current) => ({ ...current, stagedPlan: clonePlan(request) }));
    return { plan: clonePlan(next.stagedPlan) };
  }

  stagedPlan = clonePlan(request);
  return getStagedPlanSnapshot();
}

export async function resolveStagedPlanSessions(
  request: AlfredStagedPlanResolveRequest,
): Promise<AlfredStagedPlanSnapshotResponse> {
  if (persistedStateStore) {
    const next = await persistedStateStore.updateState((current) => {
      const currentPlan = current.stagedPlan;
      if (!currentPlan || request.sessionIds.length === 0) return current;

      const resolved = new Set(request.sessionIds);
      const remainingSessions = currentPlan.sessions.filter((session) => !resolved.has(session.id));
      const nextPlan = remainingSessions.length === 0 ? null : { ...currentPlan, sessions: remainingSessions };

      return { ...current, stagedPlan: nextPlan };
    });
    return { plan: clonePlan(next.stagedPlan) };
  }

  const currentPlan = stagedPlan;
  if (!currentPlan || request.sessionIds.length === 0) {
    return getStagedPlanSnapshot();
  }

  const resolved = new Set(request.sessionIds);
  const remainingSessions = currentPlan.sessions.filter((session) => !resolved.has(session.id));
  const nextPlan = remainingSessions.length === 0 ? null : { ...currentPlan, sessions: remainingSessions };

  stagedPlan = nextPlan;
  return getStagedPlanSnapshot();
}

export async function clearStagedPlanSnapshot(): Promise<AlfredStagedPlanSnapshotResponse> {
  if (persistedStateStore) {
    const next = await persistedStateStore.updateState((current) => ({ ...current, stagedPlan: null }));
    return { plan: clonePlan(next.stagedPlan) };
  }

  stagedPlan = null;
  return getStagedPlanSnapshot();
}

export function resetStagedPlanPersistence(): void {
  persistedStateStore = null;
  stagedPlan = null;
}

function clonePlan(plan: AlfredStagedPlanSnapshot | null): AlfredStagedPlanSnapshot | null {
  if (!plan) return null;
  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({
      ...session,
      args: [...session.args],
      ...(session.launchPreflight === undefined ? {} : { launchPreflight: { ...session.launchPreflight } }),
    })),
  };
}
