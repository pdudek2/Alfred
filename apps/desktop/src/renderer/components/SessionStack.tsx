import { useId, type ReactNode } from "react";
import { activitySentence, pendingApproval, waitingSentence } from "../activity-presentation";
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
  /** Shown in place of the groups while no other session runs in the project, such as its asleep sessions. */
  emptyContent?: ReactNode;
  now: number;
  planLine?: ReactNode;
  sessions: SessionTile[];
  tabs?: ReactNode;
  workspaceLabel: string;
  onFocusSession: (sessionId: string) => void;
  onOpenAsleep: () => void;
  onPinSession: (sessionId: string) => void;
};

export function SessionStack({ asleepCount, emptyContent, now, planLine, sessions, tabs, workspaceLabel, onFocusSession, onOpenAsleep, onPinSession }: SessionStackProps) {
  const states = new Map(sessions.map((session) => [session.id, sessionState(session, "ready", now)]));
  const groups = STACK_GROUPS.map((group) => ({
    ...group,
    sessions: sessions.filter((session) => group.kinds.includes(states.get(session.id)!.kind)),
  })).filter((group) => group.sessions.length > 0);

  return (
    <aside className="session-stack" aria-label={`Other sessions in ${workspaceLabel}`}>
      {tabs}
      <div className="session-stack-groups">
        {groups.length === 0 && (emptyContent ?? <p className="session-stack-empty">No other sessions in this project.</p>)}
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
                  preview={group.preview ? stackPreviewLine(session, states.get(session.id)!) : null}
                  session={session}
                  status={states.get(session.id)!}
                  onFocus={() => onFocusSession(session.id)}
                  onPin={() => onPinSession(session.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {planLine}
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
  onPin,
}: {
  now: number;
  preview: string | null;
  session: SessionTile;
  status: SessionDisplayStatus;
  onFocus: () => void;
  onPin: () => void;
}) {
  const age = sessionAgeLabel(session.lastOutputAt ?? session.createdAt, now);
  const titleId = useId();
  return (
    <li className="session-stack-item">
      <button type="button" className="session-stack-card" data-session-id={session.id} onClick={onFocus}>
        <span className="session-stack-card-head">
          <SessionStatusGlyph kind={status.kind} label={status.label} />
          <span className="session-stack-title" id={titleId}>{session.title}</span>
          {age && <span className="session-stack-age">{age}</span>}
        </span>
        {preview && <span className="session-stack-preview">{preview}</span>}
      </button>
      {/* A sibling of the card, not inside it: a button cannot hold another. It takes the age's place on hover. */}
      <button type="button" className="session-stack-pin" aria-label="Pin under the focus" aria-describedby={titleId} onClick={onPin}>
        Pin
      </button>
    </li>
  );
}

/**
 * The card's second line. The contract asks for the last output lines, but the bottom of an agent's
 * screen is its input box, so the latest classified activity stands in. Swap the source here.
 * It uses the sentences of the other surfaces: what a waiting session asks as Needs you says it, the rest as Details.
 */
export function stackPreviewLine(session: Pick<SessionTile, "activityEvents">, status: SessionDisplayStatus): string | null {
  const approval = status.kind === "needs-you" && status.reason === "approval" ? pendingApproval(session.activityEvents) : undefined;
  if (approval) return waitingSentence(approval);
  const events = session.activityEvents ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind !== "lifecycle") return activitySentence(event);
  }
  return null;
}
