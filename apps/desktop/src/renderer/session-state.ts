import type { AgentKind, AlfredPlanSession, AlfredStagedPlanSnapshot } from "../shared/alfred-ipc";
import {
  appendActivityEvent,
  classifyTerminalOutputActivities,
  type SessionActivityEvent,
  type SessionActivityEventKind,
  type SessionActivityInput,
} from "../shared/session-activity";
import type {
  TerminalCreateResult,
  PersistedTerminalSessionSnapshot,
  TerminalSessionSnapshot,
  TerminalSessionId,
} from "../shared/terminal-ipc";

export type SessionTile = {
  id: string;
  runtimeId?: TerminalSessionId;
  title: string;
  workspaceId: string;
  cwd: string;
  createdAt?: number;
  source: "manual" | "alfred";
  stage: "staged" | "live";
  runtimeStatus?: "starting" | "live" | "exited" | "error" | "restored";
  command?: string;
  args?: string[];
  agentKind?: AgentKind;
  safetyNote?: string;
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
    },
  ];
}

export function closeSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  return sessions.filter((session) => session.id !== sessionId);
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
      lastOutputAt: _lastOutputAt,
      ...attachedSession
    } = session;

    return {
      ...attachedSession,
      runtimeId: runtime.id,
      runtimeStatus: "live",
      title: runtime.title,
      cwd: runtime.cwd,
      ...(runtime.createdAt === undefined ? {} : { createdAt: runtime.createdAt }),
      ...(runtime.command === undefined ? {} : { command: runtime.command }),
      ...(runtime.args === undefined ? {} : { args: runtime.args }),
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
    const nextStage = session.source === "alfred" && !session.runtimeId ? "staged" : session.stage;
    return { ...session, stage: nextStage, runtimeStatus: "error" };
  });
}

export function markSessionExited(sessions: SessionTile[], runtimeId: TerminalSessionId): SessionTile[] {
  return sessions.map((session) =>
    session.runtimeId === runtimeId ? { ...session, runtimeStatus: "exited" } : session,
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

export function relaunchRestoredSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  return sessions.map((session) => {
    if (session.id !== sessionId || session.runtimeStatus !== "restored") return session;
    const {
      runtimeId: _runtimeId,
      ...relaunchableSession
    } = session;
    return { ...relaunchableSession, runtimeStatus: "starting" };
  });
}

export function hydrateLiveTerminalSessions(snapshots: TerminalSessionSnapshot[]): SessionTile[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.clientId ?? `runtime-${snapshot.id}`,
    runtimeId: snapshot.id,
    title: snapshot.title,
    workspaceId: snapshot.workspaceId ?? "A",
    cwd: snapshot.cwd,
    ...(snapshot.createdAt === undefined ? {} : { createdAt: snapshot.createdAt }),
    source: snapshot.source,
    stage: "live",
    runtimeStatus: "live",
    ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
    ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
    ...(snapshot.agentKind === undefined ? {} : { agentKind: snapshot.agentKind }),
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
    cwd: snapshot.cwd,
    ...(snapshot.createdAt === undefined ? {} : { createdAt: snapshot.createdAt }),
    source: snapshot.source,
    stage: "live",
    runtimeStatus: "restored",
    ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
    ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
    ...(snapshot.agentKind === undefined ? {} : { agentKind: snapshot.agentKind }),
    ...(snapshot.activityEvents === undefined ? {} : { activityEvents: snapshot.activityEvents }),
    ...(snapshot.lastActivityAt === undefined ? {} : { lastActivityAt: snapshot.lastActivityAt }),
    ...(snapshot.lastOutputAt === undefined ? {} : { lastOutputAt: snapshot.lastOutputAt }),
    initialBuffer: snapshot.buffer,
  }));
}

export function hydrateStagedPlanSessions(
  plan: AlfredStagedPlanSnapshot | null,
  defaultCwd: string,
  defaultWorkspaceId = "A",
): SessionTile[] {
  if (!plan) return [];
  return plan.sessions.map((session) => ({
    id: session.id,
    title: session.title,
    workspaceId: session.workspaceId ?? defaultWorkspaceId,
    cwd: session.cwd ?? defaultCwd,
    source: "alfred",
    stage: "staged",
    command: session.command,
    args: session.args,
    agentKind: session.kind,
    ...(session.safetyNote === undefined ? {} : { safetyNote: session.safetyNote }),
  }));
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
      ...(session.safetyNote === undefined ? {} : { safetyNote: session.safetyNote }),
    };
    nextIndex += 1;
    return tile;
  });
  return [...sessions, ...staged];
}

export function approveStaged(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.map((session) =>
    session.id === tileId && session.stage === "staged" ? { ...session, stage: "live", runtimeStatus: "starting" } : session,
  );
}

export function rejectStaged(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.filter((session) => !(session.id === tileId && session.stage === "staged"));
}

export function approveAllStaged(sessions: SessionTile[], workspaceId?: string): SessionTile[] {
  return sessions.map((session) =>
    session.stage === "staged" && !session.safetyNote && (!workspaceId || session.workspaceId === workspaceId)
      ? { ...session, stage: "live", runtimeStatus: "starting" }
      : session,
  );
}

export function rejectAllStaged(sessions: SessionTile[], workspaceId?: string): SessionTile[] {
  return sessions.filter((session) => !(session.stage === "staged" && (!workspaceId || session.workspaceId === workspaceId)));
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
  runtimeId: TerminalSessionId,
  data: string,
  now = Date.now(),
): SessionTile[] {
  const activities = classifyTerminalOutputActivities(data);
  const session = sessions.find((item) => item.runtimeId === runtimeId);
  if (!session) return sessions;
  const sessionsWithOutputAt = sessions.map((item) =>
    item.id === session.id ? { ...item, lastOutputAt: now } : item,
  );
  if (activities.length === 0) return sessionsWithOutputAt;
  return activities.reduce(
    (nextSessions, activity) => appendSessionActivity(nextSessions, session.id, activity, now),
    sessionsWithOutputAt,
  );
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
