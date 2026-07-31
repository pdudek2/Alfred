import { Server, SquareTerminal } from "lucide-react";
import type { TileKind } from "./tile-kind";
import claudeSparkUrl from "./assets/claude-spark.svg";
import codexIconUrl from "./assets/codex-icon.png";

type TileKindIconProps = {
  kind: TileKind;
  size?: number;
};

export function TileKindIcon({ kind, size = 13 }: TileKindIconProps) {
  switch (kind) {
    case "claude":
      return <img className="kind-brand-icon" src={claudeSparkUrl} alt="" aria-hidden="true" width={size} height={size} />;
    case "codex":
      return <img className="kind-brand-icon" src={codexIconUrl} alt="" aria-hidden="true" width={size} height={size} />;
    case "dev-server":
      return <Server aria-hidden="true" size={size} strokeWidth={1.9} />;
    case "manual":
      return <span className="tile-kind-prompt" aria-hidden="true">&gt;_</span>;
    case "shell":
      return <SquareTerminal aria-hidden="true" size={size} strokeWidth={1.9} />;
  }
}
