import type { SessionTile } from "./session-state";

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
