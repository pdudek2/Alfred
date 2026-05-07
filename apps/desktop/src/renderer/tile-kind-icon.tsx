import { Bot, BrainCircuit, Server, SquareTerminal, UserRound } from "lucide-react";
import type { TileKind } from "./tile-kind";

type TileKindIconProps = {
  kind: TileKind;
  size?: number;
};

export function TileKindIcon({ kind, size = 13 }: TileKindIconProps) {
  switch (kind) {
    case "claude":
      return <BrainCircuit aria-hidden="true" size={size} strokeWidth={1.9} />;
    case "codex":
      return <Bot aria-hidden="true" size={size} strokeWidth={1.9} />;
    case "dev-server":
      return <Server aria-hidden="true" size={size} strokeWidth={1.9} />;
    case "manual":
      return <UserRound aria-hidden="true" size={size} strokeWidth={1.9} />;
    case "shell":
      return <SquareTerminal aria-hidden="true" size={size} strokeWidth={1.9} />;
  }
}
