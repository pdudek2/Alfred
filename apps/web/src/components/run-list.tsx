import type { RunListItem } from "../lib/api-client";
import { formatDateTime, formatDuration } from "../lib/time";
import { StatusPill } from "./status-pill";

type RunListProps = {
  runs: RunListItem[];
  selectedRunId: string | null;
  onSelectRun(runId: string): void;
};

export function RunList({ runs, selectedRunId, onSelectRun }: RunListProps) {
  if (runs.length === 0) {
    return <div className="empty-state">No runs yet.</div>;
  }

  return (
    <div className="run-list" aria-label="Agent runs">
      {runs.map((run) => (
        <button
          className={`run-row ${run.id === selectedRunId ? "selected" : ""}`}
          key={run.id}
          onClick={() => onSelectRun(run.id)}
          type="button"
        >
          <span className="run-row-main">
            <span className="run-project">{run.project_name ?? run.project_key ?? "unknown project"}</span>
            <span className="run-source">{run.source_id}</span>
          </span>
          <span className="run-row-meta">
            <StatusPill status={run.status} />
            <span>{formatDateTime(run.started_at)}</span>
            <span>{formatDuration(run.started_at, run.completed_at)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
