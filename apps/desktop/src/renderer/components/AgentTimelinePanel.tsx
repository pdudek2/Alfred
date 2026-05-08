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
        </dl>
        <ol className="agent-activity-list">
          <li>
            <span />
            <div>
              <b>{session.stage === "staged" ? "Queued by Alfred" : runtimeEventTitle(runtimeStatus)}</b>
              <p>
                {session.stage === "staged"
                  ? "Review the proposed command before it starts."
                  : runtimeEventCopy(runtimeStatus)}
              </p>
            </div>
          </li>
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
    case "starting":
    default:
      return "starting";
  }
}

function runtimeEventTitle(status: SessionTile["runtimeStatus"]): string {
  switch (status) {
    case "error":
      return "Start failed";
    case "exited":
      return "Process exited";
    case "live":
      return "Session attached";
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
    case "starting":
    default:
      return "Alfred is attaching the runtime process.";
  }
}
