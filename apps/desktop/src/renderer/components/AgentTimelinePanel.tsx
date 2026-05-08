import type { SessionTile } from "../session-state";

type AgentTimelinePanelProps = {
  session: SessionTile | null;
};

export function AgentTimelinePanel({ session }: AgentTimelinePanelProps) {
  return (
    <aside className="agent-timeline-panel" aria-label="Agent activity">
      <header className="agent-timeline-header">
        <strong>Activity</strong>
        <span>{session ? session.title : "no focused session"}</span>
      </header>
      <div className="agent-timeline-body">
        <p className="agent-timeline-empty">
          Structured agent events will appear here as this session emits them.
        </p>
      </div>
    </aside>
  );
}
