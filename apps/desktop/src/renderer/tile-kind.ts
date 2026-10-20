import type { SessionTile } from "./session-state";

export type TileKind = "manual" | "codex" | "claude" | "dev-server" | "shell";

type TileKindMeta = {
  className: TileKind;
  /** Contract vocabulary: a session is Claude, Codex or Terminal. */
  label: "Claude" | "Codex" | "Terminal";
};

export function sessionTileKind(session: {
  agentKind?: SessionTile["agentKind"] | undefined;
  detectedAgentKind?: SessionTile["detectedAgentKind"] | undefined;
  source: SessionTile["source"];
}): TileKind {
  return session.detectedAgentKind ?? session.agentKind ?? (session.source === "manual" ? "manual" : "shell");
}

export function tileKindMeta(kind: TileKind): TileKindMeta {
  switch (kind) {
    case "claude":
      return { className: kind, label: "Claude" };
    case "codex":
      return { className: kind, label: "Codex" };
    case "dev-server":
    case "manual":
    case "shell":
      return { className: kind, label: "Terminal" };
  }
}
