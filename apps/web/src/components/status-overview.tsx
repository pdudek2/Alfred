import type { RunTriageState } from "../lib/run-view-model";

type StatusOverviewProps = {
  state: RunTriageState;
  status: string;
};

const STATUS_COPY: Record<RunTriageState, { title: string; body: string }> = {
  waiting: {
    title: "Waiting on input",
    body: "This run is paused until the next external update or operator decision arrives.",
  },
  failed: {
    title: "Failed",
    body: "The run stopped before completion. Check the activity and raw payload for the recorded failure context.",
  },
  running: {
    title: "Running",
    body: "The run is still active. Activity may continue to arrive during live refresh.",
  },
  completed: {
    title: "Completed",
    body: "The run reached a terminal successful state.",
  },
  stale: {
    title: "Stale",
    body: "This run has not reported activity for a while, so Alfred no longer treats it as live.",
  },
  other: {
    title: "Status recorded",
    body: "This status does not map to a primary triage state yet.",
  },
};

export function StatusOverview({ state, status }: StatusOverviewProps) {
  const copy = STATUS_COPY[state];

  return (
    <section className={`status-overview status-overview-${state}`} aria-label="Run state summary">
      <div>
        <span className="status-overview-label">{status}</span>
        <h3>{copy.title}</h3>
      </div>
      <p>{copy.body}</p>
    </section>
  );
}
