import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { buildBriefingVM } from "../lib/briefing";
import type { RunListItem } from "../lib/api-client";
import {
  buildTimeGroupedFeedVM,
  filterRunsForTriage,
  tabCount,
  type RunCardVM,
  type TriageTab,
} from "../lib/run-view-model";
import type { SystemStatusVM } from "../lib/system-status-view-model";
import { useKeyboardShortcut } from "../lib/use-keyboard-shortcut";
import { Briefing } from "./briefing";
import { FeedSection } from "./feed-section";
import { RunRow } from "./run-row";
import { SoftFilterBar } from "./soft-filter-bar";
import { SystemStatus } from "./system-status";

type ReaderProps = {
  runs: RunListItem[];
  now: Date;
  selectedRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  error?: unknown;
  loading?: boolean;
  systemStatus?: SystemStatusVM | null;
};

export function Reader({
  runs,
  now,
  selectedRunId,
  onSelectRun,
  error,
  loading = false,
  systemStatus,
}: ReaderProps) {
  const [tab, setTab] = useState<TriageTab>("all");
  const [query, setQuery] = useState("");
  const readerRef = useRef<HTMLElement>(null);
  const feedRef = useRef<HTMLElement>(null);

  const briefing = useMemo(() => buildBriefingVM(runs, now, error), [error, now, runs]);
  const counts = useMemo(
    () => ({
      all: tabCount(runs, "all", now),
      live: tabCount(runs, "live", now),
      needs: tabCount(runs, "needs", now),
      done: tabCount(runs, "done", now),
    }),
    [now, runs],
  );
  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const feed = useMemo(() => {
    const triageRuns = filterRunsForTriage(runs, tab, query, now);
    const feedRuns = triageRuns
      .map((run) => runById.get(run.id))
      .filter((run): run is RunListItem => run !== undefined);

    return buildTimeGroupedFeedVM(feedRuns, now);
  }, [now, query, runById, runs, tab]);
  const visibleCards = useMemo(() => feed.sections.flatMap((section) => section.runs), [feed]);
  const emptyMessage = runs.length === 0 ? "No agent has reported in yet." : "No runs match this view.";
  const loadingEmptyRuns = loading && runs.length === 0;

  useKeyboardShortcut("/", () => {
    focusSearch(readerRef.current);
  }, { ignoreEditable: true });
  useKeyboardShortcut("mod+k", () => {
    focusSearch(readerRef.current);
  }, { ignoreEditable: true });

  function handleFeedKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    if (visibleCards.length === 0) {
      return;
    }

    event.preventDefault();

    const currentIndex = selectedRunId ? visibleCards.findIndex((card) => card.id === selectedRunId) : -1;
    const nextIndex = nextCardIndex(currentIndex, event.key, visibleCards);
    const nextRunId = visibleCards[nextIndex]?.id ?? null;

    onSelectRun(nextRunId);
    if (nextRunId) {
      feedRef.current?.querySelectorAll<HTMLButtonElement>(".reader-run-row")[nextIndex]?.focus();
    }
  }

  return (
    <main className="reader" ref={readerRef}>
      <section className="reader-command" aria-label="Agent reader command">
        {loadingEmptyRuns ? null : <Briefing vm={briefing} onHighlight={(runId) => onSelectRun(runId)} />}

        <div className="reader-filter-shell">
          {systemStatus ? <SystemStatus vm={systemStatus} /> : null}
          <SoftFilterBar counts={counts} onQueryChange={setQuery} onTabChange={setTab} query={query} tab={tab} />
        </div>
      </section>

      <section
        aria-label="Run feed"
        className={`reader-feed${selectedRunId ? " reader-feed-dimmed" : ""}`}
        onKeyDown={handleFeedKeyDown}
        ref={feedRef}
        tabIndex={0}
      >
        {feed.sections.length > 0 ? (
          feed.sections.map((section) => (
            <FeedSection count={section.runs.length} key={section.label} label={section.label}>
              {section.runs.map((card) => (
                <RunRow
                  card={card}
                  key={card.id}
                  onSelect={(runId) => onSelectRun(runId)}
                  selected={card.id === selectedRunId}
                  subtitle={card.summaryLabel}
                />
              ))}
            </FeedSection>
          ))
        ) : loadingEmptyRuns ? null : (
          <p className="reader-empty-note">{emptyMessage}</p>
        )}
      </section>
    </main>
  );
}

function nextCardIndex(currentIndex: number, key: "ArrowDown" | "ArrowUp", cards: RunCardVM[]): number {
  if (currentIndex < 0) {
    return 0;
  }

  if (key === "ArrowDown") {
    return Math.min(currentIndex + 1, cards.length - 1);
  }

  return Math.max(currentIndex - 1, 0);
}

function focusSearch(root: HTMLElement | null) {
  const search = root?.querySelector<HTMLInputElement>("[data-reader-search]");
  search?.focus();
  search?.select();
}
