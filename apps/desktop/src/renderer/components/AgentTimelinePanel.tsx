import type { SessionTile } from "../session-state";
import { sessionTileKind, tileKindMeta } from "../tile-kind";

type AgentTimelinePanelProps = {
  session: SessionTile | null;
};

export function AgentTimelinePanel({ session }: AgentTimelinePanelProps) {
  if (!session) {
    return (
      <aside className="agent-timeline-panel" aria-label="Agent activity">
        <header className="agent-timeline-header">
          <strong>Activity</strong>
          <span>no selected session</span>
        </header>
        <div className="agent-timeline-body">
          <p className="agent-timeline-empty">Select a terminal to inspect its runtime, command, and activity.</p>
        </div>
      </aside>
    );
  }

  const kindMeta = tileKindMeta(sessionTileKind(session));
  const command = [session.command, ...(session.args ?? [])].filter(Boolean).join(" ");
  const runtimeStatus = session.runtimeStatus ?? (session.runtimeId ? "live" : "starting");
  const status = session.stage === "staged" ? "waiting for approval" : runtimeStatusLabel(runtimeStatus);
  const activityEvents = session.activityEvents ?? [];
  const displayedEvents =
    activityEvents.length > 0
      ? [...activityEvents].sort((a, b) => b.at - a.at)
      : [
          {
            id: `${session.id}-runtime-status`,
            kind: session.stage === "staged" ? "approval" : runtimeStatus === "error" ? "error" : "lifecycle",
            title: session.stage === "staged" ? "Queued by Alfred" : runtimeEventTitle(runtimeStatus),
            detail:
              session.stage === "staged"
                ? "Review the proposed command before it starts."
                : runtimeEventCopy(runtimeStatus),
            at: session.lastActivityAt ?? 0,
          },
        ];

  return (
    <aside className="agent-timeline-panel" aria-label="Agent activity">
      <header className="agent-timeline-header">
        <strong>{session.title}</strong>
        <span>{status}</span>
      </header>
      <div className="agent-timeline-body">
        <dl className="agent-session-facts" aria-label="session details">
          <div>
            <dt>kind</dt>
            <dd>{kindMeta.label}</dd>
          </div>
          <div>
            <dt>cwd</dt>
            <dd>{session.cwd || "default workspace"}</dd>
          </div>
          {command && (
            <div>
              <dt>command</dt>
              <dd>{command}</dd>
            </div>
          )}
          {session.lastActivityAt && (
            <div>
              <dt>last activity</dt>
              <dd>{formatActivityTime(session.lastActivityAt)}</dd>
            </div>
          )}
        </dl>
        <ol className="agent-activity-list">
          {displayedEvents.map((event) => (
            <li className={event.kind} key={event.id}>
              <span />
              <div>
                <b>{event.title}</b>
                <p>{event.detail}</p>
                {event.at > 0 && <time dateTime={new Date(event.at).toISOString()}>{formatActivityTime(event.at)}</time>}
              </div>
            </li>
          ))}
          {session.safetyNote && (
            <li className="warning">
              <span />
              <div>
                <b>Safety review required</b>
                <p>{session.safetyNote}</p>
              </div>
            </li>
          )}
        </ol>
      </div>
    </aside>
  );
}

function runtimeStatusLabel(status: SessionTile["runtimeStatus"]): string {
  switch (status) {
    case "error":
      return "start failed";
    case "exited":
      return "process exited";
    case "live":
      return "live runtime";
    case "restored":
      return "restored transcript";
    case "starting":
    default:
      return "starting";
  }
}

function formatActivityTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function runtimeEventTitle(status: SessionTile["runtimeStatus"]): string {
  switch (status) {
    case "error":
      return "Start failed";
    case "exited":
      return "Process exited";
    case "live":
      return "Session attached";
    case "restored":
      return "Transcript restored";
    case "starting":
    default:
      return "Starting terminal";
  }
}

function runtimeEventCopy(status: SessionTile["runtimeStatus"]): string {
  switch (status) {
    case "error":
      return "The runtime could not create this terminal.";
    case "exited":
      return "The process has ended; scrollback remains available in the tile.";
    case "live":
      return "Terminal output is streaming in the workspace.";
    case "restored":
      return "This is the last saved scrollback. Start a new terminal to continue work.";
    case "starting":
    default:
      return "Alfred is attaching the runtime process.";
  }
}
