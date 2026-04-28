import { Clock3 } from "lucide-react";

import type { RunDetail, RunListItem } from "../lib/api-client";
import { formatDateTime, formatDuration } from "../lib/time";
import { StatusPill } from "./status-pill";

type RunDetailProps = {
  run: RunDetail | RunListItem | null;
  loading: boolean;
};

export function RunDetailPanel({ run, loading }: RunDetailProps) {
  if (loading) {
    return <section className="detail-panel">Loading run</section>;
  }

  if (!run) {
    return <section className="detail-panel">Select a run.</section>;
  }

  const events = "events" in run ? run.events : [];

  return (
    <section className="detail-panel" aria-label="Run detail">
      <header className="detail-header">
        <div>
          <p className="eyebrow">{run.source_id}</p>
          <h2>{run.project_name ?? run.project_key ?? "unknown project"}</h2>
        </div>
        <StatusPill status={run.status} />
      </header>

      <dl className="run-facts">
        <div>
          <dt>Started</dt>
          <dd>{formatDateTime(run.started_at)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{formatDateTime(run.completed_at)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(run.started_at, run.completed_at)}</dd>
        </div>
      </dl>

      {events.length === 0 ? (
        <div className="empty-state">No timeline events loaded yet.</div>
      ) : (
        <ol className="timeline">
          {events.map((event) => (
            <li className="timeline-event" key={event.id}>
              <Clock3 aria-hidden="true" size={16} />
              <div>
                <span className="event-type">{event.type}</span>
                <span className="event-time">{formatDateTime(event.occurred_at)}</span>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
