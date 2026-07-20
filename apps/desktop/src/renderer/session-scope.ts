import type { SessionTile } from "./session-state";

export function isNavigableLiveSession(session: SessionTile): boolean {
  return session.stage === "live"
    && session.runtimeStatus !== "restored"
    && session.runtimeStatus !== "exited"
    && session.runtimeStatus !== "error";
}

export function isFreeChatSession(session: SessionTile): boolean {
  return isNavigableLiveSession(session) && session.cwd.includes("/Documents/Codex/");
}
