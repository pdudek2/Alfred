import type { AgentKind } from "../shared/alfred-ipc";

export type SessionTile = {
  id: string;
  title: string;
  cwd: string;
  source: "manual" | "alfred";
  stage: "staged" | "live";
  command?: string;
  args?: string[];
  agentKind?: AgentKind;
  safetyNote?: string;
};

const MANUAL_SESSION_PREFIX = "manual-";

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
