import { type KeyboardEvent, useMemo, useState } from "react";

import type { RunDetail, RunListItem } from "../lib/api-client";
import { toRunDetailViewModel } from "../lib/run-view-model";
import { RunActivity } from "./run-activity";
import { StatusPill } from "./status-pill";
import { StatusOverview } from "./status-overview";

type RunDetailProps = {
  run: RunDetail | RunListItem | null;
  loading: boolean;
  onBackToRuns?: () => void;
};

export function RunDetailPanel({ run, loading, onBackToRuns }: RunDetailProps) {
  const [activeTab, setActiveTab] = useState<"activity" | "raw">("activity");
  const viewModel = useMemo(() => (run ? toRunDetailViewModel(run) : null), [run]);
  const tabs = ["activity", "raw"] as const;

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = tabs.indexOf(activeTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    setActiveTab(tabs[nextIndex] ?? activeTab);
  }

  if (loading) {
    return (
      <section className="detail-panel" aria-busy="true">
        Loading run
      </section>
    );
  }

  if (!viewModel) {
    return <section className="detail-panel">Select a run.</section>;
  }

  return (
    <section className="detail-panel" aria-label="Run detail">
      <button className="back-to-runs" onClick={onBackToRuns} type="button">
        Back to runs
      </button>

      <header className="detail-header">
        <div>
          <p className="eyebrow">{viewModel.source}</p>
          <h2>{viewModel.title}</h2>
          <p className="detail-subtitle">{viewModel.subtitle}</p>
        </div>
        <StatusPill status={viewModel.status} />
      </header>

      <StatusOverview state={viewModel.triageState} status={viewModel.status} />

      <dl className="run-facts">
        <div>
          <dt>Started</dt>
          <dd>{viewModel.startedAt}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{viewModel.completedAt}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{viewModel.duration}</dd>
        </div>
        <div>
          <dt>Source run</dt>
          <dd>{viewModel.sourceRunId}</dd>
        </div>
      </dl>

      <div className="detail-tabs" role="tablist" aria-label="Run detail views">
        <button
          aria-controls="run-detail-activity-panel"
          aria-selected={activeTab === "activity"}
          className="detail-tab"
          id="run-detail-activity-tab"
          onKeyDown={handleTabKey}
          onClick={() => setActiveTab("activity")}
          role="tab"
          tabIndex={activeTab === "activity" ? 0 : -1}
          type="button"
        >
          Activity
        </button>
        <button
          aria-controls="run-detail-raw-panel"
          aria-selected={activeTab === "raw"}
          className="detail-tab"
          id="run-detail-raw-tab"
          onKeyDown={handleTabKey}
          onClick={() => setActiveTab("raw")}
          role="tab"
          tabIndex={activeTab === "raw" ? 0 : -1}
          type="button"
        >
          Raw
        </button>
      </div>

      <div
        aria-labelledby={activeTab === "activity" ? "run-detail-activity-tab" : "run-detail-raw-tab"}
        className="detail-tab-panel"
        id={activeTab === "activity" ? "run-detail-activity-panel" : "run-detail-raw-panel"}
        role="tabpanel"
      >
        {activeTab === "activity" ? (
          <RunActivity events={viewModel.events} />
        ) : (
          <pre className="raw-run-body">{JSON.stringify(viewModel.raw, null, 2)}</pre>
        )}
      </div>
    </section>
  );
}
