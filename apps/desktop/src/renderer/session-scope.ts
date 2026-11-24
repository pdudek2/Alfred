import type { SessionTile } from "./session-state";
import { isAgentSession } from "./session-status";

export function isWorkSession(session: Pick<SessionTile, "runtimeStatus">): boolean {
  return session.runtimeStatus !== "restored";
}

/** Asleep or ended: no process runs, and the session waits in History to be resumed. */
export function isAsleepOrEnded(session: Pick<SessionTile, "runtimeStatus">): boolean {
  return session.runtimeStatus === "restored" || session.runtimeStatus === "exited" || session.runtimeStatus === "error";
}

/** A project's sessions on the deck: live terminals, not drafts or asleep ones. */
export function deckSessions(sessions: readonly SessionTile[], workspaceId: string): SessionTile[] {
  return sessions.filter((session) => session.workspaceId === workspaceId && isWorkSession(session) && session.stage === "live");
}

/** A Terminal-kind session (plain shell or dev server); one running claude or codex in its foreground is an agent. */
export function isShellSession(session: Pick<SessionTile, "agentKind" | "command" | "detectedAgentKind">): boolean {
  return !isAgentSession(session);
}

/** The deck and the rail tree hold a project's live agents; its shells sit in the drawer. */
export function deckAgentSessions(sessions: readonly SessionTile[], workspaceId: string): SessionTile[] {
  return deckSessions(sessions, workspaceId).filter((session) => !isShellSession(session));
}

/** The drawer's tabs: a project's running shells. An ended shell waits in History. */
export function drawerSessions(sessions: readonly SessionTile[], workspaceId: string): SessionTile[] {
  return deckSessions(sessions, workspaceId).filter((session) => isShellSession(session) && !isAsleepOrEnded(session));
}

/** The deck focuses the selected session, else the project's first. It follows the selection only, never runtime events. */
export function deckFocusSession(sessions: readonly SessionTile[], selectedSessionId: string | null): SessionTile | null {
  return sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
}

export function isNavigableLiveSession(session: SessionTile): boolean {
  return session.stage === "live"
    && session.runtimeStatus !== "restored"
    && session.runtimeStatus !== "exited"
    && session.runtimeStatus !== "error";
}

export function isFreeChatScope(session: Pick<SessionTile, "cwd">): boolean {
  return isFreeChatPath(session.cwd);
}

export function isFreeChatPath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.endsWith("/Documents/Codex") || normalized.includes("/Documents/Codex/");
}

export function isFreeChatSession(session: SessionTile): boolean {
  return isNavigableLiveSession(session) && isFreeChatScope(session);
}
