import type { SessionTile } from "./session-state";

export type TileKind = "manual" | "codex" | "claude" | "dev-server" | "shell";

type TileKindMeta = {
  className: TileKind;
  label: string;
  shortLabel: string;
};

export function sessionTileKind(session: {
  agentKind?: SessionTile["agentKind"] | undefined;
  source: SessionTile["source"];
}): TileKind {
  return session.agentKind ?? (session.source === "manual" ? "manual" : "shell");
}

export function tileKindMeta(kind: TileKind): TileKindMeta {
  switch (kind) {
    case "claude":
      return { className: kind, label: "Claude", shortLabel: "Cl" };
    case "codex":
      return { className: kind, label: "Codex", shortLabel: "Cx" };
    case "dev-server":
      return { className: kind, label: "Server", shortLabel: "Srv" };
    case "manual":
      return { className: kind, label: "Manual", shortLabel: "M" };
    case "shell":
      return { className: kind, label: "Shell", shortLabel: "Sh" };
  }
}
