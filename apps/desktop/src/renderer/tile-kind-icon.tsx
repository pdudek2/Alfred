import { Server } from "lucide-react";
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
    case "shell":
      return <TerminalMark size={size} />;
  }
}

function TerminalMark({ size }: { size: number }) {
  return (
    <svg className="kind-terminal-mark" aria-hidden="true" width={size} height={size} viewBox="0 0 16 16">
      <path d="M2.5 4.5l3.5 3.5-3.5 3.5M8 12h5.5" />
    </svg>
  );
}
