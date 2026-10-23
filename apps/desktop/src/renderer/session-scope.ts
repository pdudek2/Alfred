import type { SessionTile } from "./session-state";

export function isWorkSession(session: Pick<SessionTile, "runtimeStatus">): boolean {
  return session.runtimeStatus !== "restored";
}

/** A project's sessions on the deck: live terminals, not drafts or asleep ones. */
export function deckSessions(sessions: readonly SessionTile[], workspaceId: string): SessionTile[] {
  return sessions.filter((session) => session.workspaceId === workspaceId && isWorkSession(session) && session.stage === "live");
}

/** The deck focuses the selected session, else the project's first. It follows the selection only, never runtime events. */
export function deckFocusSession(sessions: readonly SessionTile[], selectedSessionId: string | null): SessionTile | null {
  return sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null;
}

export function isReviewableWorktreeSession(
  session: Pick<
    SessionTile,
    "baseCwd" | "branchName" | "isolation" | "workspaceId" | "workspaceRootFingerprint"
  > | null | undefined,
): boolean {
  if (session?.isolation === "shared") return false;
  return Boolean(
    session?.branchName
    && (session.baseCwd || (session.workspaceId && session.workspaceRootFingerprint)),
  );
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
