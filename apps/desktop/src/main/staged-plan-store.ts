import type {
  AlfredError,
  AlfredStagedPlanSessionUpdateRequest,
  AlfredStagedPlanSessionUpdateResponse,
  AlfredStagedPlanResolveRequest,
  AlfredStagedPlanSetRequest,
  AlfredStagedPlanSnapshot,
  AlfredStagedPlanSnapshotResponse,
  AlfredStagedSession,
} from "../shared/alfred-ipc.js";
import { checkSafety } from "./alfred-safety.js";
import { preflightAlfredPlanSession, type AlfredLaunchPreflightOptions } from "./alfred-launch-preflight.js";
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

export async function updateStagedPlanSession(
  request: AlfredStagedPlanSessionUpdateRequest,
  options: { preflightOptions?: AlfredLaunchPreflightOptions } = {},
): Promise<AlfredStagedPlanSessionUpdateResponse> {
  const invalidRequest = validateUpdateRequest(request);
  if (invalidRequest) return { ok: false, error: invalidRequest };

  if (persistedStateStore) {
    let error: AlfredError | null = null;
    const next = await persistedStateStore.updateState(async (current) => {
      const update = await applyStagedPlanSessionUpdate(current.stagedPlan, request, options.preflightOptions ?? {});
      if (!update.ok) {
        error = update.error;
        return current;
      }

      return { ...current, stagedPlan: update.plan };
    });

    if (error) return { ok: false, error };
    if (!next.stagedPlan) {
      return { ok: false, error: notFoundError("Staged plan is no longer available.") };
    }

    return { ok: true, plan: cloneExistingPlan(next.stagedPlan) };
  }

  const update = await applyStagedPlanSessionUpdate(stagedPlan, request, options.preflightOptions ?? {});
  if (!update.ok) return update;

  stagedPlan = update.plan;
  return { ok: true, plan: cloneExistingPlan(stagedPlan) };
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

async function applyStagedPlanSessionUpdate(
  currentPlan: AlfredStagedPlanSnapshot | null,
  request: AlfredStagedPlanSessionUpdateRequest,
  preflightOptions: AlfredLaunchPreflightOptions,
): Promise<AlfredStagedPlanSessionUpdateResponse> {
  if (!currentPlan || currentPlan.id !== request.planId) {
    return { ok: false, error: notFoundError("The staged plan has changed. Refresh before editing this session.") };
  }

  const sessionIndex = currentPlan.sessions.findIndex((session) => session.id === request.sessionId);
  if (sessionIndex < 0) {
    return { ok: false, error: notFoundError("The staged session is no longer available.") };
  }

  const currentSession = currentPlan.sessions[sessionIndex];
  if (!currentSession) {
    return { ok: false, error: notFoundError("The staged session is no longer available.") };
  }

  const patchedSession = applyEditablePatch(currentSession, request);
  const safety = checkSafety(patchedSession.command, patchedSession.args);
  const safetyAnnotatedSession = safety.unsafe
    ? { ...patchedSession, safetyNote: safety.reason }
    : withoutSafetyNote(patchedSession);
  const nextSession = await preflightAlfredPlanSession(safetyAnnotatedSession, request.workspace, preflightOptions);
  const sessions = currentPlan.sessions.map((session, index) => (index === sessionIndex ? nextSession : session));

  return { ok: true, plan: cloneExistingPlan({ ...currentPlan, sessions }) };
}

function applyEditablePatch(
  session: AlfredStagedSession,
  request: AlfredStagedPlanSessionUpdateRequest,
): AlfredStagedSession {
  const patch = request.patch;
  const next: AlfredStagedSession = { ...session, args: [...session.args] };

  if (hasOwn(patch, "title")) {
    next.title = patch.title as string;
  }
  if (hasOwn(patch, "cwd")) {
    next.cwd = patch.cwd as string;
  }
  if (hasOwn(patch, "command")) {
    next.command = patch.command as string;
  }
  if (hasOwn(patch, "args")) {
    next.args = [...(patch.args as string[])];
  }

  return next;
}

function validateUpdateRequest(request: AlfredStagedPlanSessionUpdateRequest): AlfredError | null {
  if (!request || typeof request.planId !== "string" || typeof request.sessionId !== "string" || !isRecord(request.patch)) {
    return malformedError("Invalid staged session update request.");
  }

  if (!request.planId.trim() || !request.sessionId.trim()) {
    return malformedError("Staged session update requires planId and sessionId.");
  }

  const patch = request.patch as Record<string, unknown>;
  const editableKeys = new Set(["title", "cwd", "command", "args"]);

  for (const key of Object.keys(patch)) {
    if (!editableKeys.has(key)) {
      return malformedError(`Staged session field "${key}" cannot be patched.`);
    }
  }

  if (hasOwn(patch, "title") && typeof patch.title !== "string") {
    return malformedError("Staged session title must be a string.");
  }
  if (hasOwn(patch, "cwd") && typeof patch.cwd !== "string") {
    return malformedError("Staged session cwd must be a string.");
  }
  if (hasOwn(patch, "command") && typeof patch.command !== "string") {
    return malformedError("Staged session command must be a string.");
  }
  if (
    hasOwn(patch, "args") &&
    (!Array.isArray(patch.args) || !patch.args.every((arg) => typeof arg === "string"))
  ) {
    return malformedError("Staged session args must be an array of strings.");
  }

  return null;
}

function withoutSafetyNote(session: AlfredStagedSession): AlfredStagedSession {
  const { safetyNote: _safetyNote, ...next } = session;
  return next;
}

function malformedError(message: string): AlfredError {
  return { code: "malformed", message };
}

function notFoundError(message: string): AlfredError {
  return { code: "not_found", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function clonePlan(plan: AlfredStagedPlanSnapshot | null): AlfredStagedPlanSnapshot | null {
  if (!plan) return null;
  return cloneExistingPlan(plan);
}

function cloneExistingPlan(plan: AlfredStagedPlanSnapshot): AlfredStagedPlanSnapshot {
  return {
    ...plan,
    sessions: plan.sessions.map((session) => ({
      ...session,
      args: [...session.args],
      ...(session.launchPreflight === undefined ? {} : { launchPreflight: { ...session.launchPreflight } }),
    })),
  };
}
