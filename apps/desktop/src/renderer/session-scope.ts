import type { SessionTile } from "./session-state";
import { terminalSessionDisplayStatus } from "./session-status";
import { sessionTileKind } from "./tile-kind";

export function isWorkSession(session: Pick<SessionTile, "runtimeStatus">): boolean {
  return session.runtimeStatus !== "restored";
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

export function isActiveAgentSession(session: SessionTile): boolean {
  const kind = sessionTileKind(session);
  const agentKind = kind === "codex" || kind === "claude"
    ? kind
    : session.command === "codex" || session.command === "claude"
      ? session.command
      : null;
  if (!agentKind || !isNavigableLiveSession(session) || isFreeChatScope(session)) return false;

  const status = terminalSessionDisplayStatus(session).kind;
  return status === "starting" || status === "active" || status === "idle";
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
