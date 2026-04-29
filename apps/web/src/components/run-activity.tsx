import { Clock3 } from "lucide-react";

import type { RunEventItem } from "../lib/api-client";
import { buildActivityGroups } from "../lib/run-view-model";
import { formatDateTime } from "../lib/time";
import { EventPayload } from "./event-payload";

type RunActivityProps = {
  events: RunEventItem[];
};

export function RunActivity({ events }: RunActivityProps) {
  if (events.length === 0) {
    return <div className="empty-state">No timeline events loaded yet.</div>;
  }

  return (
    <div className="activity-groups">
      {buildActivityGroups(events).map((group) => (
        <details
          className={`activity-group activity-group-${group.kind}`}
          key={group.kind}
          open={group.kind === "failure" || group.kind === "waiting" || group.count <= 12}
        >
          <summary className="activity-group-header">
            <div>
              <p>{group.label}</p>
              <h3>{activityGroupCopy(group.kind)}</h3>
            </div>
            <span>{group.count}</span>
          </summary>

          <EventList events={group.events.slice(0, 8)} />
          {group.events.length > 8 ? (
            <details className="activity-overflow">
              <summary>Show {group.events.length - 8} older events</summary>
              <EventList events={group.events.slice(8)} />
            </details>
          ) : null}
        </details>
      ))}
    </div>
  );
}

function EventList({ events }: { events: ReturnType<typeof buildActivityGroups>[number]["events"] }) {
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li className="timeline-event" key={event.id}>
          <Clock3 aria-hidden="true" size={15} />
          <div>
            <span className="event-type">{event.type}</span>
            <span className="event-time">{formatDateTime(event.occurredAt)}</span>
            <EventPayload payload={event.payload} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function activityGroupCopy(kind: ReturnType<typeof buildActivityGroups>[number]["kind"]) {
  if (kind === "failure") return "Interruptions and failed tool calls";
  if (kind === "waiting") return "Moments that may need outside input";
  if (kind === "tool") return "Tools used by the agent";
  if (kind === "run") return "Session lifecycle";
  return "Additional recorded events";
}
