import { Search, X } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";

import type { RunListItem } from "../lib/api-client";
import { buildRunListVM, tabCount, TRIAGE_TABS, type TriageTab } from "../lib/run-view-model";
import { StatusPill } from "./status-pill";

type RunListProps = {
  runs: RunListItem[];
  selectedRunId: string | null;
  filtered: boolean;
  onClearFilters(): void;
  onSelectRun(runId: string): void;
};

export function RunList({ runs, selectedRunId, filtered, onClearFilters, onSelectRun }: RunListProps) {
  const [activeTab, setActiveTab] = useState<TriageTab>("all");
  const [search, setSearch] = useState("");
  const listView = useMemo(
    () => buildRunListVM(runs, { tab: activeTab, query: search, grouping: "status" }),
    [activeTab, runs, search],
  );
  const tabs = TRIAGE_TABS.map((tab) => tab.id);

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

  if (runs.length === 0) {
    return (
      <div className="empty-state">
        <p>{filtered ? "No runs match current filters." : "No runs yet."}</p>
        {filtered ? (
          <button className="empty-action" onClick={onClearFilters} type="button">
            Show all runs
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="run-list-shell">
      <div className="triage-tabs" role="tablist" aria-label="Run triage">
        {TRIAGE_TABS.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className="triage-tab"
            key={tab.id}
            onKeyDown={handleTabKey}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            <span>{tab.id === "needs" ? "Needs you" : tab.label}</span>
            <span className="triage-tab-count">{tabCount(runs, tab.id)}</span>
          </button>
        ))}
      </div>

      <label className="run-search">
        <Search aria-hidden="true" size={15} />
        <input
          aria-label="Search runs"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search runs"
          type="search"
          value={search}
        />
        {search ? (
          <button aria-label="Clear run search" onClick={() => setSearch("")} type="button">
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
      </label>

      {listView.groups.length === 0 ? (
        <div className="empty-state">
          <p>No runs match this triage view.</p>
        </div>
      ) : (
        <div className="run-list" aria-label="Agent runs">
          {listView.groups.map((group) => (
            <details
              className={`run-group run-group-${group.key}`}
              key={group.key}
              open={group.key !== "stale" || activeTab !== "all" || group.runs.some((run) => run.id === selectedRunId)}
            >
              <summary>
                <span>{groupLabel(group.key)}</span>
                <span>{group.count}</span>
              </summary>
              {group.runs.map((run) => (
                <RunRow key={run.id} run={run} selected={run.id === selectedRunId} onSelectRun={onSelectRun} />
              ))}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function groupLabel(key: string) {
  if (key === "running") return "Live now";
  if (key === "waiting") return "Needs you";
  if (key === "failed") return "Failed";
  if (key === "completed") return "Done";
  if (key === "stale") return "Quiet archive";
  return key;
}

type RunRowProps = {
  run: ReturnType<typeof buildRunListVM>["groups"][number]["runs"][number];
  selected: boolean;
  onSelectRun(runId: string): void;
};

function RunRow({ run, selected, onSelectRun }: RunRowProps) {
  const sourceRunLabel = run.sourceRunId.trim();
  const primaryTitle =
    run.title === sourceRunLabel && sourceRunLabel !== run.id && run.projectLabel !== "unknown project"
      ? run.projectLabel
      : run.title;

  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={`run-row ${selected ? "selected" : ""}`}
      onClick={() => onSelectRun(run.id)}
      type="button"
    >
      <span className="run-row-main">
        <span className="run-title-block">
          <span className="run-project">{primaryTitle}</span>
          <span className="run-source">{run.sourceLabel}</span>
        </span>
        <StatusPill status={run.status} />
      </span>
      <span className="run-row-meta">
        <span>{run.startedAtLabel}</span>
        <span>{run.durationLabel}</span>
      </span>
    </button>
  );
}
