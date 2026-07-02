import { AlertTriangle, Check, Circle, CircleSlash, Play, RotateCcw, Search, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SessionDisplayStatus } from "../session-status";

export type SessionStatusGlyphKind = SessionDisplayStatus["kind"];

type SessionStatusGlyphProps = {
  kind: SessionStatusGlyphKind;
  label: string;
};

const statusIcons: Record<SessionStatusGlyphKind, LucideIcon> = {
  active: Play,
  blocked: AlertTriangle,
  done: Check,
  error: CircleSlash,
  idle: Circle,
  restored: RotateCcw,
  runtime: CircleSlash,
  staged: Check,
  checking: Search,
  starting: Timer,
  waiting: AlertTriangle,
};

export function SessionStatusGlyph({ kind, label }: SessionStatusGlyphProps) {
  const Icon = statusIcons[kind];

  return (
    <span className={`session-status-glyph status-${kind}`} aria-label={`status ${label}`} title={label}>
      <Icon aria-hidden="true" size={13} strokeWidth={1.9} />
    </span>
  );
}
