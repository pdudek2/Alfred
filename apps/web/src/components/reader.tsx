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
import { formatDateTime } from "../lib/time";
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
  lastLoadedAt?: Date | null;
  loading?: boolean;
  notice?: string | null;
  systemStatus?: SystemStatusVM | null;
};

export function Reader({
  runs,
  now,
  selectedRunId,
  onSelectRun,
  error,
  lastLoadedAt = null,
  loading = false,
  notice = null,
  systemStatus,
}: ReaderProps) {
  const [tab, setTab] = useState<TriageTab>("all");
  const [query, setQuery] = useState("");
  const readerRef = useRef<HTMLElement>(null);
  const feedRef = useRef<HTMLElement>(null);

  const feedBanner = useMemo(
    () => buildFeedBannerVM({ error, lastLoadedAt, loading, runsLength: runs.length }),
    [error, lastLoadedAt, loading, runs.length],
  );
  const briefingError = feedBanner?.tone === "cached" ? null : error;
  const briefing = useMemo(
    () => buildBriefingVM(runs, now, briefingError, systemStatus),
    [briefingError, now, runs, systemStatus],
  );
  const counts = useMemo(
    () => ({
      all: tabCount(runs, "all", now),
      live: tabCount(runs, "live", now),
      needs: tabCount(runs, "needs", now),
      problems: tabCount(runs, "problems", now),
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
  const emptyMessage = "No runs match this view.";
  const initialLoading = feedBanner?.tone === "loading";

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
        {initialLoading ? null : <Briefing vm={briefing} onHighlight={(runId) => onSelectRun(runId)} />}

        <div className="reader-filter-shell">
          {systemStatus ? <SystemStatus vm={systemStatus} /> : null}
          <SoftFilterBar counts={counts} onQueryChange={setQuery} onTabChange={setTab} query={query} tab={tab} />
        </div>
        {notice ? (
          <p className="reader-notice" role="status">
            {notice}
          </p>
        ) : null}
      </section>

      <section
        aria-label="Run feed"
        className={`reader-feed${selectedRunId ? " reader-feed-dimmed" : ""}`}
        onKeyDown={handleFeedKeyDown}
        ref={feedRef}
        tabIndex={0}
      >
        {feedBanner ? <ReaderFeedBanner vm={feedBanner} /> : null}
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
        ) : feedBanner ? null : (
          <p className="reader-empty-note">{emptyMessage}</p>
        )}
      </section>
    </main>
  );
}

type FeedBannerTone = "loading" | "cached" | "empty" | "offline";

type FeedBannerVM = {
  detail: string;
  title: string;
  tone: FeedBannerTone;
};

function ReaderFeedBanner({ vm }: { vm: FeedBannerVM }) {
  return (
    <div className={`reader-feed-banner reader-feed-banner--${vm.tone}`} role="status">
      <p className="reader-feed-banner__title">{vm.title}</p>
      <p className="reader-feed-banner__detail">{vm.detail}</p>
    </div>
  );
}

function buildFeedBannerVM({
  error,
  lastLoadedAt,
  loading,
  runsLength,
}: {
  error?: unknown;
  lastLoadedAt: Date | null;
  loading: boolean;
  runsLength: number;
}): FeedBannerVM | null {
  if (loading && runsLength === 0) {
    return {
      detail: "Checking the latest agent activity.",
      title: "Loading run feed",
      tone: "loading",
    };
  }

  if (error && runsLength > 0) {
    return {
      detail: lastLoadedAt
        ? `Last loaded ${formatDateTime(lastLoadedAt.toISOString())}; refresh failed.`
        : "Refresh failed, so this feed may be behind.",
      title: "Showing last loaded runs",
      tone: "cached",
    };
  }

  if (error && runsLength === 0) {
    return {
      detail: "The feed will update when Alfred can reach the run API again.",
      title: "Cannot refresh right now",
      tone: "offline",
    };
  }

  if (!loading && runsLength === 0) {
    return {
      detail: "When an agent reports in, it will appear here.",
      title: "No runs loaded yet",
      tone: "empty",
    };
  }

  return null;
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
