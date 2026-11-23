import { isDeepSeekLaunch } from "../shared/agent-command";
import type { SessionTile } from "./session-state";

export type TileKind = "manual" | "codex" | "claude" | "deepseek" | "dev-server" | "shell";

type TileKindMeta = {
  className: TileKind;
  /** Contract vocabulary: a session is Claude, Codex, DeepSeek or Terminal. */
  label: "Claude" | "Codex" | "DeepSeek" | "Terminal";
};

export function sessionTileKind(session: {
  agentKind?: SessionTile["agentKind"] | undefined;
  detectedAgentKind?: SessionTile["detectedAgentKind"] | undefined;
  source: SessionTile["source"];
  command?: string | undefined;
  args?: readonly string[] | undefined;
}): TileKind {
  const kind = session.detectedAgentKind ?? session.agentKind ?? (session.source === "manual" ? "manual" : "shell");
  return kind === "claude" && isDeepSeekLaunch(session.command, session.args) ? "deepseek" : kind;
}

export function tileKindMeta(kind: TileKind): TileKindMeta {
  switch (kind) {
    case "claude":
      return { className: kind, label: "Claude" };
    case "codex":
      return { className: kind, label: "Codex" };
    case "deepseek":
      return { className: kind, label: "DeepSeek" };
    case "dev-server":
    case "manual":
    case "shell":
      return { className: kind, label: "Terminal" };
  }
}
