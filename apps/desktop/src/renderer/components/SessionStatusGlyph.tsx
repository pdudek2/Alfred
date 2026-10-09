import type { ReactNode } from "react";
import type { SessionDisplayStatus } from "../session-status";
import "./session-status-glyph.css";

export type SessionStatusGlyphKind = SessionDisplayStatus["kind"];

type SessionStatusGlyphProps = {
  kind: SessionStatusGlyphKind;
  label: string;
  className?: string;
  size?: number;
};

const STAR = "M8 1.5c.5 3.8 2.7 6 6.5 6.5C10.7 8.5 8.5 10.7 8 14.5 7.5 10.7 5.3 8.5 1.5 8 5.3 7.5 7.5 5.3 8 1.5Z";
const ring = <circle className="glyph-ring" cx="8" cy="8" r="5.25" />;
const failedMark = (
  <>
    {ring}
    <path className="glyph-mark" d="M8 5.3v3.2" />
    <circle className="glyph-dot" cx="8" cy="10.6" r=".85" />
  </>
);
const progress = (
  <>
    <circle className="glyph-track" cx="8" cy="8" r="5.25" />
    <path className="glyph-arc" d="M8 2.75a5.25 5.25 0 0 1 5.25 5.25" />
  </>
);

// The v4 canvas glyph grammar (contract §4): one shape per state on every surface.
const statusShapes: Record<SessionStatusGlyphKind, ReactNode> = {
  "needs-you": <path className="glyph-star-fill" d={STAR} />,
  "your-turn": <path className="glyph-star-outline" d={STAR} />,
  working: progress,
  running: progress,
  idle: ring,
  failed: failedMark,
  done: <>{ring}<path className="glyph-mark" d="M5.7 8.1l1.6 1.6 3-3.2" /></>,
  draft: <circle className="glyph-ring glyph-dashed" cx="8" cy="8" r="5.25" />,
  asleep: <>{ring}<path className="glyph-mark" d="M5.6 8h4.8" /></>,
  unavailable: failedMark,
};

export function SessionStatusGlyph({ kind, label, className, size = 13 }: SessionStatusGlyphProps) {
  return (
    <span className={`session-status-glyph status-${kind}${className ? ` ${className}` : ""}`} aria-label={`status ${label}`} title={label}>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width={size} height={size}>
        {statusShapes[kind]}
      </svg>
    </span>
  );
}
