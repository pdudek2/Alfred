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
import { normalizeAgentCommand } from "../shared/agent-command.js";
import { checkSafety } from "./alfred-safety.js";
import { preflightAlfredPlanSession, type AlfredLaunchPreflightOptions } from "./alfred-launch-preflight.js";
import type { PersistedDesktopStateStore } from "./persisted-desktop-state.js";

type StagedPlans = Record<string, AlfredStagedPlanSnapshot>;
let stagedPlans: StagedPlans = {};
let mutationQueue: Promise<unknown> = Promise.resolve();
let persistedStateStore: PersistedDesktopStateStore | null = null;

export function configureStagedPlanPersistence(store: PersistedDesktopStateStore): void {
  persistedStateStore = store;
  stagedPlans = {};
}

export async function getStagedPlansSnapshot(): Promise<AlfredStagedPlanSnapshotResponse> {
  const plans = persistedStateStore ? (await persistedStateStore.getState()).stagedPlans : stagedPlans;
  return snapshot(plans);
}

async function updatePlans(
  transform: (plans: StagedPlans) => StagedPlans | Promise<StagedPlans>,
): Promise<AlfredStagedPlanSnapshotResponse> {
  if (persistedStateStore) {
    const next = await persistedStateStore.updateState(async (current) => ({
      ...current,
      stagedPlans: await transform(current.stagedPlans),
    }));
    return snapshot(next.stagedPlans);
  }
  const operation = mutationQueue.then(async () => {
    stagedPlans = await transform(stagedPlans);
    return snapshot(stagedPlans);
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

export async function setStagedPlanSnapshot(
  request: AlfredStagedPlanSetRequest,
): Promise<AlfredStagedPlanSnapshotResponse> {
  if (typeof request?.workspaceId !== "string" || !request.workspaceId.trim() || !Array.isArray(request.sessions) || request.sessions.some(
    (session) => !session || (session.workspaceId !== undefined && session.workspaceId !== request.workspaceId),
  )) {
    throw Object.assign(new Error("Staged plan sessions must belong to the plan workspace."), { code: "malformed" });
  }
  const plan = cloneExistingPlan(request);
  return updatePlans((plans) => {
    const next = { ...plans };
    if (plan.sessions.length) next[plan.workspaceId] = plan;
    else delete next[plan.workspaceId];
    return next;
  });
}

export async function resolveStagedPlanSessions(
  request: AlfredStagedPlanResolveRequest,
): Promise<AlfredStagedPlanSnapshotResponse> {
  const resolved = new Set(request.sessionIds);
  return updatePlans((plans) => Object.fromEntries(Object.entries(plans).flatMap(([workspaceId, plan]) => {
    const sessions = plan.sessions.filter((session) => !resolved.has(session.id));
    return sessions.length ? [[workspaceId, { ...plan, sessions }]] : [];
  })));
}

export async function updateStagedPlanSession(
  request: AlfredStagedPlanSessionUpdateRequest,
  options: { preflightOptions?: AlfredLaunchPreflightOptions } = {},
): Promise<AlfredStagedPlanSessionUpdateResponse> {
  const invalidRequest = validateUpdateRequest(request);
  if (invalidRequest) return { ok: false, error: invalidRequest };

  let result: AlfredStagedPlanSessionUpdateResponse = {
    ok: false, error: notFoundError("Staged plan is no longer available."),
  };
  await updatePlans(async (plans) => {
    const plan = Object.values(plans).find((item) => item.id === request.planId) ?? null;
    result = await applyStagedPlanSessionUpdate(plan, request, options.preflightOptions ?? {});
    return result.ok ? { ...plans, [result.plan.workspaceId]: cloneExistingPlan(result.plan) } : plans;
  });
  return result;
}

export async function clearStagedPlanSnapshot(
  request: { workspaceId: string },
): Promise<AlfredStagedPlanSnapshotResponse> {
  return updatePlans((plans) => {
    const next = { ...plans };
    delete next[request.workspaceId];
    return next;
  });
}

function snapshot(plans: StagedPlans): AlfredStagedPlanSnapshotResponse {
  return { plans: Object.values(plans).map(cloneExistingPlan) };
}

export async function isStagedSessionLaunchAllowed(request: {
  args?: string[];
  clientId?: string;
  command?: string;
}): Promise<boolean> {
  if (!request.clientId || !request.command) return false;

  const { plans } = await getStagedPlansSnapshot();
  const session = plans.flatMap((plan) => plan.sessions).find((item) => item.id === request.clientId);
  if (!session) return false;
  if (session.safetyNote) return false;
  if (session.launchPreflight?.status === "blocked") return false;
  if (session.command !== request.command) return false;
  return stringArraysEqual(session.args, request.args ?? []);
}

export function resetStagedPlanPersistence(): void {
  persistedStateStore = null;
  stagedPlans = {};
  mutationQueue = Promise.resolve();
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

  const invalidIsolationPatch = validateSessionIsolationPatch(currentSession, request);
  if (invalidIsolationPatch) return { ok: false, error: invalidIsolationPatch };

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
  if (hasOwn(patch, "isolation")) {
    next.isolation = patch.isolation as "shared" | "worktree";
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
  const editableKeys = new Set(["title", "cwd", "command", "args", "isolation"]);

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
  if (hasOwn(patch, "isolation") && patch.isolation !== "shared" && patch.isolation !== "worktree") {
    return malformedError("Staged session isolation must be shared or worktree.");
  }

  return null;
}

function validateSessionIsolationPatch(
  session: AlfredStagedSession,
  request: AlfredStagedPlanSessionUpdateRequest,
): AlfredError | null {
  if (!hasOwn(request.patch, "isolation") || request.patch.isolation !== "worktree") {
    return null;
  }

  if (session.kind !== "codex" && session.kind !== "claude") {
    return malformedError("Staged session worktree isolation requires a codex or claude session.");
  }

  if (!request.workspace?.rootPath?.trim()) {
    return malformedError("Staged session worktree isolation requires a workspace root.");
  }

  return null;
}

function withoutSafetyNote(session: AlfredStagedSession): AlfredStagedSession {
  const { safetyNote: _safetyNote, ...next } = session;
  return next;
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function cloneExistingPlan(plan: AlfredStagedPlanSnapshot): AlfredStagedPlanSnapshot {
  return {
    ...plan,
    sessions: plan.sessions.map((session) => {
      const normalizedSession = normalizeAgentCommand(session);
      return {
        ...normalizedSession,
        workspaceId: plan.workspaceId,
        args: [...normalizedSession.args],
        ...(normalizedSession.launchPreflight === undefined
          ? {}
          : { launchPreflight: { ...normalizedSession.launchPreflight } }),
      };
    }),
  };
}
