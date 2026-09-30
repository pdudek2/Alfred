import { AlertTriangle, Check, Circle, CircleSlash, CornerDownLeft, Play, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SessionDisplayStatus } from "../session-status";

export type SessionStatusGlyphKind = SessionDisplayStatus["kind"];

type SessionStatusGlyphProps = {
  kind: SessionStatusGlyphKind;
  label: string;
};

const statusIcons: Record<SessionStatusGlyphKind, LucideIcon> = {
  "needs-you": AlertTriangle,
  "your-turn": CornerDownLeft,
  working: Play,
  running: Play,
  idle: Circle,
  failed: CircleSlash,
  done: Check,
  draft: Check,
  asleep: RotateCcw,
  unavailable: CircleSlash,
};

export function SessionStatusGlyph({ kind, label }: SessionStatusGlyphProps) {
  const Icon = statusIcons[kind];

  return (
    <span className={`session-status-glyph status-${kind}`} aria-label={`status ${label}`} title={label}>
      <Icon aria-hidden="true" size={13} strokeWidth={1.9} />
    </span>
  );
}
