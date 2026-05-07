import type { AgentKind, AlfredPlanSession } from "../shared/alfred-ipc";
import type { TerminalSessionSnapshot, TerminalSessionId } from "../shared/terminal-ipc";

export type SessionTile = {
  id: string;
  runtimeId?: TerminalSessionId;
  title: string;
  cwd: string;
  source: "manual" | "alfred";
  stage: "staged" | "live";
  command?: string;
  args?: string[];
  agentKind?: AgentKind;
  safetyNote?: string;
  initialBuffer?: string;
};

const MANUAL_SESSION_PREFIX = "manual-";
const ALFRED_SESSION_PREFIX = "alfred-";

export function createInitialSessions(cwd: string): SessionTile[] {
  return [createManualSession(1, cwd)];
}

export function addManualSession(sessions: SessionTile[], cwd: string): SessionTile[] {
  const nextIndex = nextManualSessionIndex(sessions);
  return [...sessions, createManualSession(nextIndex, cwd)];
}

export function closeSession(sessions: SessionTile[], sessionId: string): SessionTile[] {
  return sessions.filter((session) => session.id !== sessionId);
}

export function attachRuntimeSession(
  sessions: SessionTile[],
  tileId: string,
  runtimeId: TerminalSessionId,
): SessionTile[] {
  return sessions.map((session) =>
    session.id === tileId ? { ...session, runtimeId } : session,
  );
}

export function hydrateLiveTerminalSessions(snapshots: TerminalSessionSnapshot[]): SessionTile[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.clientId ?? `runtime-${snapshot.id}`,
    runtimeId: snapshot.id,
    title: snapshot.title,
    cwd: snapshot.cwd,
    source: snapshot.source,
    stage: "live",
    ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
    ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
    ...(snapshot.agentKind === undefined ? {} : { agentKind: snapshot.agentKind }),
    initialBuffer: snapshot.buffer,
  }));
}

function createManualSession(index: number, cwd: string): SessionTile {
  return {
    id: `${MANUAL_SESSION_PREFIX}${index}`,
    title: `Manual · zsh ${index}`,
    cwd,
    source: "manual",
    stage: "live",
  };
}

function nextManualSessionIndex(sessions: SessionTile[]): number {
  const usedIndexes = sessions.map((session) => {
    if (!session.id.startsWith(MANUAL_SESSION_PREFIX)) {
      return 0;
    }

    const index = Number.parseInt(session.id.slice(MANUAL_SESSION_PREFIX.length), 10);
    return Number.isInteger(index) ? index : 0;
  });

  return Math.max(0, ...usedIndexes) + 1;
}

export function addStagedSessions(
  sessions: SessionTile[],
  planSessions: AlfredPlanSession[],
  defaultCwd: string,
): SessionTile[] {
  let nextIndex = nextAlfredSessionIndex(sessions);
  const staged: SessionTile[] = planSessions.map((session) => {
    const tile: SessionTile = {
      id: `${ALFRED_SESSION_PREFIX}${nextIndex}`,
      title: session.title,
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
    session.id === tileId && session.stage === "staged" ? { ...session, stage: "live" } : session,
  );
}

export function rejectStaged(sessions: SessionTile[], tileId: string): SessionTile[] {
  return sessions.filter((session) => !(session.id === tileId && session.stage === "staged"));
}

export function approveAllStaged(sessions: SessionTile[]): SessionTile[] {
  return sessions.map((session) =>
    session.stage === "staged" && !session.safetyNote ? { ...session, stage: "live" } : session,
  );
}

export function rejectAllStaged(sessions: SessionTile[]): SessionTile[] {
  return sessions.filter((session) => session.stage !== "staged");
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
