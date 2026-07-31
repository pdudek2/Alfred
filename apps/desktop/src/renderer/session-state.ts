import type { AgentKind, AlfredLaunchPreflight, AlfredPlanSession, AlfredStagedPlanSnapshot } from "../shared/alfred-ipc";
import {
  appendActivityEvent,
  type SessionActivityEvent,
  type SessionActivityInput,
} from "../shared/session-activity";
import type {
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  PersistedTerminalSessionSnapshot,
  TerminalSessionSnapshot,
  TerminalSessionId,
  TerminalSessionIsolation,
  TerminalResumeTarget,
} from "../shared/terminal-ipc";
import { normalizeSessionTitle } from "../shared/session-title";

export type SessionTile = {
  id: string;
  runtimeId?: TerminalSessionId;
  title: string;
  workspaceId: string;
  workspaceRootFingerprint?: string;
  cwd: string;
  isolation?: TerminalSessionIsolation;
  branchName?: string;
  baseCwd?: string;
  createdAt?: number;
  source: "manual" | "alfred";
  stage: "staged" | "live";
  stagedReviewStatus?: "checking" | "edited";
  runtimeStatus?: "starting" | "live" | "exited" | "error" | "restored" | "unavailable";
  command?: string;
  args?: string[];
  resumeTarget?: TerminalResumeTarget;
  resumeMode?: "exact" | "latest";
  agentKind?: AgentKind;
  detectedAgentKind?: Extract<AgentKind, "codex" | "claude"> | undefined;
  safetyNote?: string;
  launchPreflight?: AlfredLaunchPreflight;
  initialBuffer?: string;
  activityEvents?: SessionActivityEvent[];
  lastActivityAt?: number;
  lastOutputAt?: number;
};

export type { SessionActivityEvent, SessionActivityEventKind, SessionActivityInput } from "../shared/session-activity";

const MANUAL_SESSION_PREFIX = "manual-";
const ALFRED_SESSION_PREFIX = "alfred-";
const MAX_ACTIVITY_EVENTS = 40;

export function createInitialSessions(cwd: string, workspaceId = "A"): SessionTile[] {
  return [createManualSession(1, cwd, workspaceId)];
}

export function addManualSession(sessions: SessionTile[], cwd: string, workspaceId = "A"): SessionTile[] {
  const nextIndex = nextManualSessionIndex(sessions);
  return [...sessions, createManualSession(nextIndex, cwd, workspaceId)];
}

export function addAgentSession(
  sessions: SessionTile[],
  kind: Extract<AgentKind, "claude" | "codex">,
  cwd: string,
  workspaceId = "A",
  isolation: TerminalSessionIsolation = "shared",
): SessionTile[] {
  const nextIndex = nextPrefixedSessionIndex(sessions, `${kind}-`);
  const title = `${kind === "codex" ? "Codex" : "Claude"} · session ${nextIndex}`;
  return [
    ...sessions,
    {
      id: `${kind}-${nextIndex}`,
      title,
      workspaceId,
      cwd,
      source: "manual",
      stage: "live",
      runtimeStatus: "starting",
      agentKind: kind,
      command: kind,
      args: [],
      isolation,
    },
  ];
}

export function closeSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  return sessions.filter((session) => session.id !== sessionId);
}

export function sessionInstanceKey(
  session: Pick<
    SessionTile,
    "baseCwd" | "branchName" | "createdAt" | "id" | "runtimeId"
  >,
): string {
  return [
    session.id,
    session.runtimeId ?? "",
    session.createdAt ?? "",
    session.branchName ?? "",
    session.baseCwd ?? "",
  ].join("\u001f");
}

export function renameSession(sessions: SessionTile[], sessionId: string, title: string): SessionTile[] {
  const normalizedTitle = normalizeSessionTitle(title);
  if (!normalizedTitle) return sessions;

  return sessions.map((session) => session.id === sessionId ? { ...session, title: normalizedTitle } : session);
}

export function attachRuntimeSession(
  sessions: SessionTile[],
  tileId: string,
  runtime: TerminalCreateResult,
): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== tileId) return session;
    const {
      createdAt: _createdAt,
      initialBuffer: _initialBuffer,
      launchPreflight: _launchPreflight,
      lastOutputAt: _lastOutputAt,
      ...attachedSession
    } = session;

    const exitedBeforeAttachStatus = session.runtimeId === runtime.id
      && (session.runtimeStatus === "exited" || session.runtimeStatus === "error")
      ? session.runtimeStatus
      : null;
    return {
      ...attachedSession,
      runtimeId: runtime.id,
      runtimeStatus: exitedBeforeAttachStatus ?? "live",
      title: runtime.title,
      cwd: runtime.cwd,
      ...(runtime.isolation === undefined ? {} : { isolation: runtime.isolation }),
      ...(runtime.branchName === undefined ? {} : { branchName: runtime.branchName }),
      ...(runtime.baseCwd === undefined ? {} : { baseCwd: runtime.baseCwd }),
      ...(runtime.createdAt === undefined ? {} : { createdAt: runtime.createdAt }),
      ...(runtime.command === undefined ? {} : { command: runtime.command }),
      ...(runtime.args === undefined ? {} : { args: runtime.args }),
      ...(runtime.resumeTarget === undefined ? {} : { resumeTarget: runtime.resumeTarget }),
      ...(runtime.agentKind === undefined ? {} : { agentKind: runtime.agentKind }),
      ...(runtime.workspaceId === undefined ? {} : { workspaceId: runtime.workspaceId }),
    };
  });
}

export function markSessionStartFailed(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== tileId) return session;
    if (session.runtimeStatus === "starting" && !session.runtimeId && session.initialBuffer) {
      return { ...session, runtimeStatus: "restored" };
    }
    const { launchPreflight: _launchPreflight, ...retryableSession } = session;
    const nextStage = session.source === "alfred" && !session.runtimeId ? "staged" : session.stage;
    return { ...retryableSession, stage: nextStage, runtimeStatus: "error" };
  });
}

export function markSessionUnavailable(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== tileId) return session;
    if (session.runtimeStatus === "unavailable") return session;
    const { launchPreflight: _launchPreflight, runtimeId: _runtimeId, ...unavailableSession } = session;
    return { ...unavailableSession, runtimeStatus: "unavailable" };
  });
}

export function markSessionExited(
  sessions: SessionTile[],
  runtimeId: TerminalSessionId,
  exitCode = 0,
  clientId?: string,
): SessionTile[] {
  const runtimeStatus = exitCode === 0 ? "exited" : "error";
  return sessions.map((session) =>
    terminalEventMatchesSession(session, {
      id: runtimeId,
      ...(clientId === undefined ? {} : { clientId }),
    })
      ? { ...session, runtimeId, runtimeStatus }
      : session,
  );
}

export function restartSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const {
      initialBuffer: _initialBuffer,
      lastOutputAt: _lastOutputAt,
      runtimeId: _runtimeId,
      createdAt: _createdAt,
      ...restartableSession
    } = session;
    return { ...restartableSession, runtimeStatus: "starting" };
  });
}

export function canRelaunchRestoredSession(
  session: Pick<
    SessionTile,
    "agentKind" | "command" | "cwd" | "runtimeStatus" | "source"
  >,
): boolean {
  if (session.runtimeStatus !== "restored" || !session.cwd) return false;
  if (session.agentKind === "codex" || session.agentKind === "claude") {
    return session.command === session.agentKind;
  }
  if (session.source === "manual" && !session.agentKind) return true;
  return Boolean(session.command);
}

export function relaunchRestoredSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== sessionId || !canRelaunchRestoredSession(session)) return session;
    const {
      runtimeId: _runtimeId,
      ...relaunchableSession
    } = session;
    return { ...relaunchableSession, ...resumeLaunchForRestoredAgent(session), runtimeStatus: "starting" };
  });
}

export function hydrateLiveTerminalSessions(snapshots: TerminalSessionSnapshot[]): SessionTile[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.clientId ?? `runtime-${snapshot.id}`,
    runtimeId: snapshot.id,
    title: snapshot.title,
    workspaceId: snapshot.workspaceId ?? "A",
    cwd: snapshot.cwd,
    ...(snapshot.workspaceRootFingerprint === undefined
      ? {}
      : { workspaceRootFingerprint: snapshot.workspaceRootFingerprint }),
    ...(snapshot.isolation === undefined ? {} : { isolation: snapshot.isolation }),
    ...(snapshot.branchName === undefined ? {} : { branchName: snapshot.branchName }),
    ...(snapshot.baseCwd === undefined ? {} : { baseCwd: snapshot.baseCwd }),
    ...(snapshot.createdAt === undefined ? {} : { createdAt: snapshot.createdAt }),
    source: snapshot.source,
    stage: "live",
    runtimeStatus: "live",
    ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
    ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
    ...(snapshot.resumeTarget === undefined ? {} : { resumeTarget: snapshot.resumeTarget }),
    ...(snapshot.agentKind === undefined ? {} : { agentKind: snapshot.agentKind }),
    ...(snapshot.foregroundAgentKind === undefined ? {} : { detectedAgentKind: snapshot.foregroundAgentKind }),
    ...(snapshot.activityEvents === undefined ? {} : { activityEvents: snapshot.activityEvents }),
    ...(snapshot.lastActivityAt === undefined ? {} : { lastActivityAt: snapshot.lastActivityAt }),
    ...(snapshot.lastOutputAt === undefined ? {} : { lastOutputAt: snapshot.lastOutputAt }),
    initialBuffer: snapshot.buffer,
  }));
}

export function hydratePersistedTerminalSessions(snapshots: PersistedTerminalSessionSnapshot[]): SessionTile[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.clientId,
    title: snapshot.title,
    workspaceId: snapshot.workspaceId ?? "A",
    cwd: snapshot.cwd ?? "",
    ...(snapshot.workspaceRootFingerprint === undefined
      ? {}
      : { workspaceRootFingerprint: snapshot.workspaceRootFingerprint }),
    ...(snapshot.isolation === undefined ? {} : { isolation: snapshot.isolation }),
    ...(snapshot.branchName === undefined ? {} : { branchName: snapshot.branchName }),
    ...(snapshot.baseCwd === undefined ? {} : { baseCwd: snapshot.baseCwd }),
    ...(snapshot.createdAt === undefined ? {} : { createdAt: snapshot.createdAt }),
    source: snapshot.source,
    stage: "live",
    runtimeStatus: "restored",
    ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
    ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
    ...(snapshot.resumeTarget === undefined ? {} : { resumeTarget: snapshot.resumeTarget }),
    ...(snapshot.agentKind === undefined ? {} : { agentKind: snapshot.agentKind }),
    ...resumeModeForRestoredAgent(snapshot),
    ...(snapshot.activityEvents === undefined ? {} : { activityEvents: snapshot.activityEvents }),
    ...(snapshot.lastActivityAt === undefined ? {} : { lastActivityAt: snapshot.lastActivityAt }),
    ...(snapshot.lastOutputAt === undefined ? {} : { lastOutputAt: snapshot.lastOutputAt }),
    initialBuffer: snapshot.buffer ?? "",
  }));
}

export function hydrateStagedPlanSessions(
  plan: AlfredStagedPlanSnapshot | null,
  defaultCwd: string,
  defaultWorkspaceId = "A",
): SessionTile[] {
  if (!plan) return [];
  return plan.sessions.map((session) => {
    const isolation = plannedSessionIsolation(session.kind, session.launchPreflight, planSessionIsolation(session));
    return {
      id: session.id,
      title: session.title,
      workspaceId: session.workspaceId ?? defaultWorkspaceId,
      cwd: session.cwd ?? defaultCwd,
      source: "alfred",
      stage: "staged",
      command: session.command,
      args: session.args,
      agentKind: session.kind,
      ...(isolation === undefined ? {} : { isolation }),
      ...(session.safetyNote === undefined ? {} : { safetyNote: session.safetyNote }),
      ...(session.launchPreflight === undefined ? {} : { launchPreflight: cloneLaunchPreflight(session.launchPreflight) }),
    };
  });
}

function resumeLaunchForRestoredAgent(
  session: Pick<SessionTile, "agentKind" | "args" | "command" | "resumeTarget">,
): Pick<SessionTile, "command" | "args" | "resumeMode"> {
  const agentKind = restoredAgentKind(session);

  if (agentKind === "codex") {
    if (session.resumeTarget?.agentKind === "codex") {
      return { command: "codex", args: ["resume", session.resumeTarget.sessionId], resumeMode: "exact" };
    }
    return { command: "codex", args: ["resume", "--last"], resumeMode: "latest" };
  }

  if (agentKind === "claude") {
    return { command: "claude", args: ["--continue"] };
  }

  return {};
}

function resumeModeForRestoredAgent(
  session: Pick<
    PersistedTerminalSessionSnapshot,
    "agentKind" | "command" | "cwd" | "resumeTarget" | "source"
  >,
): Pick<SessionTile, "resumeMode"> {
  if (!canRelaunchRestoredSession({
    cwd: session.cwd ?? "",
    runtimeStatus: "restored",
    source: session.source,
    ...(session.agentKind === undefined ? {} : { agentKind: session.agentKind }),
    ...(session.command === undefined ? {} : { command: session.command }),
  })) return {};
  if (restoredAgentKind(session) !== "codex") return {};
  return { resumeMode: session.resumeTarget?.agentKind === "codex" ? "exact" : "latest" };
}

function restoredAgentKind(
  session: Pick<SessionTile, "agentKind" | "command">,
): AgentKind | undefined {
  return session.agentKind ?? (session.command === "codex" || session.command === "claude" ? session.command : undefined);
}

function plannedSessionIsolation(
  kind: AgentKind,
  launchPreflight: AlfredLaunchPreflight | undefined,
  explicitIsolation?: TerminalSessionIsolation,
): TerminalSessionIsolation | undefined {
  if (launchPreflight?.status === "ready") return launchPreflight.isolation;
  if (explicitIsolation) return explicitIsolation;
  return kind === "codex" || kind === "claude" ? "shared" : undefined;
}

function planSessionIsolation(session: AlfredPlanSession): TerminalSessionIsolation | undefined {
  return session.isolation;
}

function createManualSession(index: number, cwd: string, workspaceId: string): SessionTile {
  return {
    id: `${MANUAL_SESSION_PREFIX}${index}`,
    title: `Manual · zsh ${index}`,
    workspaceId,
    cwd,
    source: "manual",
    stage: "live",
    runtimeStatus: "starting",
  };
}

function nextManualSessionIndex(sessions: SessionTile[]): number {
  return nextPrefixedSessionIndex(sessions, MANUAL_SESSION_PREFIX);
}

function nextPrefixedSessionIndex(sessions: SessionTile[], prefix: string): number {
  const usedIndexes = sessions.map((session) => {
    if (!session.id.startsWith(prefix)) return 0;
    const index = Number.parseInt(session.id.slice(prefix.length), 10);
    return Number.isInteger(index) ? index : 0;
  });

  return Math.max(0, ...usedIndexes) + 1;
}

export function addStagedSessions(
  sessions: SessionTile[],
  planSessions: AlfredPlanSession[],
  defaultCwd: string,
  workspaceId = "A",
): SessionTile[] {
  let nextIndex = nextAlfredSessionIndex(sessions);
  const staged: SessionTile[] = planSessions.map((session) => {
    const isolation = plannedSessionIsolation(session.kind, session.launchPreflight, planSessionIsolation(session));
    const tile: SessionTile = {
      id: `${ALFRED_SESSION_PREFIX}${nextIndex}`,
      title: session.title,
      workspaceId,
      cwd: session.cwd ?? defaultCwd,
      source: "alfred",
      stage: "staged",
      command: session.command,
      args: session.args,
      agentKind: session.kind,
      ...(isolation === undefined ? {} : { isolation }),
      ...(session.safetyNote === undefined ? {} : { safetyNote: session.safetyNote }),
      ...(session.launchPreflight === undefined ? {} : { launchPreflight: cloneLaunchPreflight(session.launchPreflight) }),
    };
    nextIndex += 1;
    return tile;
  });
  return [...sessions, ...staged];
}

export function approveStaged(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.map((session) =>
    session.id === tileId && session.stage === "staged" && isLaunchableStagedSession(session)
      ? { ...session, stage: "live", runtimeStatus: "starting" }
      : session,
  );
}

export function rejectStaged(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.filter((session) => !(session.id === tileId && session.stage === "staged"));
}

export function isLaunchBlocked(session: Pick<SessionTile, "launchPreflight" | "safetyNote">): boolean {
  return Boolean(session.safetyNote) || session.launchPreflight?.status === "blocked";
}

function isLaunchableStagedSession(
  session: Pick<SessionTile, "launchPreflight" | "stagedReviewStatus">,
): boolean {
  return session.stagedReviewStatus !== "checking" && !isLaunchBlocked(session);
}

function cloneLaunchPreflight(preflight: AlfredLaunchPreflight): AlfredLaunchPreflight {
  return { ...preflight };
}

export function appendSessionActivity(
  sessions: SessionTile[],
  sessionId: string,
  activity: SessionActivityInput,
  now = Date.now(),
): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const result = appendActivityEvent(session.activityEvents, session.id, activity, now, MAX_ACTIVITY_EVENTS);
    return {
      ...session,
      lastActivityAt: result.lastActivityAt,
      activityEvents: result.events,
    };
  });
}

export function recordSessionOutputActivity(
  sessions: SessionTile[],
  event: TerminalDataEvent,
  now = Date.now(),
): SessionTile[] {
  const session = sessions.find((item) => terminalEventMatchesSession(item, event));
  if (!session) return sessions;
  return sessions.map((item) => {
    if (item.id !== session.id) return item;

    const previousEvents = item.activityEvents ?? [];
    const eventIds = new Set(previousEvents.map((activity) => activity.id));
    const acceptedEvents = event.activities.filter((activity) => {
      if (eventIds.has(activity.id)) return false;
      eventIds.add(activity.id);
      return true;
    });
    const activityEvents = [...previousEvents, ...acceptedEvents].slice(-MAX_ACTIVITY_EVENTS);
    const acceptedLastActivityAt = acceptedEvents.reduce<number | undefined>(
      (latest, activity) => latest === undefined ? activity.at : Math.max(latest, activity.at),
      undefined,
    );
    const lastActivityAt = acceptedLastActivityAt === undefined
      ? item.lastActivityAt
      : Math.max(item.lastActivityAt ?? acceptedLastActivityAt, acceptedLastActivityAt);
    const outputAt = acceptedLastActivityAt ?? now;

    return {
      ...item,
      detectedAgentKind: event.foregroundAgentKind,
      lastOutputAt: Math.max(item.lastOutputAt ?? outputAt, outputAt),
      ...(activityEvents.length === 0 ? {} : { activityEvents }),
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    };
  });
}

export function terminalEventMatchesSession(
  session: Pick<SessionTile, "id" | "runtimeId">,
  event: Pick<TerminalDataEvent | TerminalExitEvent, "clientId" | "id">,
): boolean {
  return session.runtimeId !== undefined
    ? session.runtimeId === event.id
    : event.clientId !== undefined && session.id === event.clientId;
}

function nextAlfredSessionIndex(sessions: SessionTile[]): number {
  const usedIndexes = sessions
    .filter((session) => session.id.startsWith(ALFRED_SESSION_PREFIX))
    .map((session) => {
      const index = Number.parseInt(session.id.slice(ALFRED_SESSION_PREFIX.length), 10);
      return Number.isInteger(index) ? index : 0;
    });

  return Math.max(0, ...usedIndexes) + 1;
}
