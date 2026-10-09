import { useEffect, useState } from "react";
import type { SessionTile } from "../session-state";
import { sessionState, type SessionDisplayStatus, type SessionStateKind } from "../session-status";
import { sessionAgeLabel } from "../session-time";
import { SessionStatusGlyph } from "./SessionStatusGlyph";
import "./session-stack.css";

// Contract order. Cards that wait for you or are busy carry a preview line; idle and ended are one-line rows.
const STACK_GROUPS: ReadonlyArray<{ label: string; kinds: readonly SessionStateKind[]; preview: boolean }> = [
  { label: "Needs you", kinds: ["needs-you"], preview: true },
  { label: "Your turn", kinds: ["your-turn"], preview: true },
  { label: "Working", kinds: ["working"], preview: true },
  { label: "Running", kinds: ["running"], preview: true },
  { label: "Idle", kinds: ["idle"], preview: false },
  { label: "Ended", kinds: ["failed", "done", "unavailable"], preview: false },
];

type SessionStackProps = {
  asleepCount: number;
  sessions: SessionTile[];
  workspaceLabel: string;
  onFocusSession: (sessionId: string) => void;
  onOpenAsleep: () => void;
};

export function SessionStack({ asleepCount, sessions, workspaceLabel, onFocusSession, onOpenAsleep }: SessionStackProps) {
  const now = useStackClock(sessions.length > 0);
  const states = new Map(sessions.map((session) => [session.id, sessionState(session, "ready", now)]));
  const groups = STACK_GROUPS.map((group) => ({
    ...group,
    sessions: sessions.filter((session) => group.kinds.includes(states.get(session.id)!.kind)),
  })).filter((group) => group.sessions.length > 0);

  return (
    <aside className="session-stack" aria-label={`Other sessions in ${workspaceLabel}`}>
      <div className="session-stack-groups">
        {groups.length === 0 && <p className="session-stack-empty">No other sessions in this project.</p>}
        {groups.map((group) => (
          <section className="session-stack-group" key={group.label} aria-label={group.label}>
            <h3>
              <span>{group.label}</span>
              <span className="session-stack-count">{group.sessions.length}</span>
            </h3>
            <ul>
              {group.sessions.map((session) => (
                <StackCard
                  key={session.id}
                  now={now}
                  preview={group.preview ? stackPreviewLine(session) : null}
                  session={session}
                  status={states.get(session.id)!}
                  onFocus={() => onFocusSession(session.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {asleepCount > 0 && (
        <button
          type="button"
          className="session-stack-asleep"
          aria-label={`Browse ${asleepCount} asleep session${asleepCount === 1 ? "" : "s"}`}
          onClick={onOpenAsleep}
        >
          <SessionStatusGlyph kind="asleep" label="asleep" />
          <span>{asleepCount} asleep</span>
        </button>
      )}
    </aside>
  );
}

function StackCard({
  now,
  preview,
  session,
  status,
  onFocus,
}: {
  now: number;
  preview: string | null;
  session: SessionTile;
  status: SessionDisplayStatus;
  onFocus: () => void;
}) {
  const age = sessionAgeLabel(session.lastOutputAt ?? session.createdAt, now);
  return (
    <li>
      <button type="button" className="session-stack-card" data-session-id={session.id} onClick={onFocus}>
        <span className="session-stack-card-head">
          <SessionStatusGlyph kind={status.kind} label={status.label} />
          <span className="session-stack-title">{session.title}</span>
          {age && <span className="session-stack-age">{age}</span>}
        </span>
        {preview && <span className="session-stack-preview">{preview}</span>}
      </button>
    </li>
  );
}

/**
 * The card's second line. The contract asks for the last output lines, but the bottom of an agent's
 * screen is its input box, so the latest classified activity stands in. Swap the source here.
 */
export function stackPreviewLine(session: Pick<SessionTile, "activityEvents">): string | null {
  const events = session.activityEvents ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind !== "lifecycle") return event.detail || event.title;
  }
  return null;
}

// Working decays to Your turn or Idle without new events, so the stack needs its own clock.
export function useStackClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(intervalId);
  }, [active]);
  return now;
}
