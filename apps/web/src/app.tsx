import { Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FilterBar } from "./components/filter-bar";
import { ObservatoryMockup } from "./components/observatory-mockup";
import { Reader } from "./components/reader";
import { RunReader } from "./components/run-reader";
import { RunDetailPanel } from "./components/run-detail";
import { RunList } from "./components/run-list";
import { StatusStrip } from "./components/status-strip";
import { createApiClient, type RunDetail, type RunFilters, type RunListItem } from "./lib/api-client";
import { buildOverviewVM } from "./lib/run-view-model";
import { formatDateTime } from "./lib/time";
import { useKeyboardShortcut } from "./lib/use-keyboard-shortcut";

const api = createApiClient();
const LIVE_REFRESH_MS = 15_000;

function hasActiveFilters(filters: RunFilters) {
  return Object.values(filters).some((value) => value !== undefined && value.trim() !== "");
}

export function App() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runFilters, setRunFilters] = useState<RunFilters>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [readerNow, setReaderNow] = useState(() => new Date());
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const selectedRunSummary = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const activeRunCount = useMemo(() => buildOverviewVM(runs).liveCount, [runs]);
  const filtered = hasActiveFilters(runFilters);
  const mockupEnabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("mockup");
  const nextEnabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("next");
  const readerEnabled = nextEnabled && !mockupEnabled;

  function setSelectedFromDrawer(runId: string | null) {
    const next = new URLSearchParams(window.location.search);
    if (runId) {
      next.set("run", runId);
    } else {
      next.delete("run");
    }

    const query = next.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    setSelectedRunId(runId);
  }

  async function loadSelectedRun(runId: string, clearBeforeLoad = true) {
    setLoadingDetail(true);
    if (clearBeforeLoad) {
      setSelectedRun(null);
    }

    try {
      const run = await api.getRun(runId);
      setSelectedRun(run);
    } catch (loadError) {
      if (clearBeforeLoad) {
        setSelectedRun(null);
      }
      setError(loadError instanceof Error ? loadError.message : "Failed to load run");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function loadRuns(refreshDetail = false, filters = runFilters) {
    setLoadingRuns(true);
    setError(null);

    try {
      const items = await api.listRuns({ limit: 25, filters });
      const syncedAt = new Date();
      setRuns(items);
      setLastSyncedAt(syncedAt.toISOString());
      setReaderNow(syncedAt);
      const nextSelectedRunId =
        selectedRunId && items.some((run) => run.id === selectedRunId)
          ? selectedRunId
          : readerEnabled
            ? null
            : (items[0]?.id ?? null);

      setSelectedRunId(nextSelectedRunId);
      if (refreshDetail && nextSelectedRunId) {
        await loadSelectedRun(nextSelectedRunId, false);
      } else if (!nextSelectedRunId) {
        setSelectedRun(null);
        setMobileDetailOpen(false);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load runs");
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    void loadRuns(false, runFilters);
  }, [runFilters]);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadRuns(true, runFilters);
    }, LIVE_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [autoRefresh, runFilters, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }

    let active = true;
    setLoadingDetail(true);
    setSelectedRun(null);

    api
      .getRun(selectedRunId)
      .then((run) => {
        if (active) setSelectedRun(run);
      })
      .catch((loadError) => {
        if (active) {
          setSelectedRun(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load run");
        }
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });

    return () => {
      active = false;
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (!readerEnabled) return;
    const runIdFromUrl = new URLSearchParams(window.location.search).get("run");
    if (runIdFromUrl && runIdFromUrl !== selectedRunId) {
      setSelectedRunId(runIdFromUrl);
    }
  }, [readerEnabled, selectedRunId]);

  useKeyboardShortcut("escape", () => {
    if (readerEnabled && selectedRunId) {
      setSelectedFromDrawer(null);
    }
  });

  function selectRun(runId: string) {
    setSelectedRunId(runId);
    setMobileDetailOpen(true);
  }

  if (mockupEnabled) {
    return (
      <ObservatoryMockup
        autoRefresh={autoRefresh}
        lastSyncedAt={lastSyncedAt}
        loading={loadingRuns}
        onRefresh={() => void loadRuns(true)}
        onSelectRun={selectRun}
        onToggleLive={() => setAutoRefresh((current) => !current)}
        runs={runs}
        selectedRun={selectedRun ?? selectedRunSummary}
        selectedRunId={selectedRunId}
      />
    );
  }

  if (readerEnabled) {
    const drawerRun = selectedRun && selectedRun.id === selectedRunId ? selectedRun : null;

    return (
      <>
        <Reader
          error={error}
          loading={loadingRuns}
          now={readerNow}
          onSelectRun={setSelectedFromDrawer}
          runs={runs}
          selectedRunId={selectedRunId}
        />
        {drawerRun ? (
          <div className="run-reader-overlay run-reader-overlay-visible">
            <RunReader detail={drawerRun} now={readerNow} onClose={() => setSelectedFromDrawer(null)} />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <main className={`app-shell ${mobileDetailOpen ? "mobile-detail-open" : ""}`}>
      <header className="top-bar">
        <div>
          <p className="eyebrow">Agent observatory</p>
          <h1>Alfred</h1>
        </div>
        <div className="top-actions">
          <div className="sync-state" aria-label="Sync state">
            <span className={`live-dot ${autoRefresh ? "live-dot-on" : ""}`} aria-hidden="true" />
            <span>{autoRefresh ? "Live" : "Paused"}</span>
            <span>{lastSyncedAt ? `Last sync ${formatDateTime(lastSyncedAt)}` : "Not synced yet"}</span>
          </div>
          <button
            className="text-button"
            onClick={() => setAutoRefresh((current) => !current)}
            type="button"
            aria-label={autoRefresh ? "Pause live updates" : "Resume live updates"}
          >
            {autoRefresh ? <Pause aria-hidden="true" size={15} /> : <Play aria-hidden="true" size={15} />}
            {autoRefresh ? "Pause" : "Live"}
          </button>
          <button
            className="icon-button"
            disabled={loadingRuns}
            onClick={() => void loadRuns(true)}
            type="button"
            aria-label="Refresh runs"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}

      <StatusStrip runs={runs} selectedRunId={selectedRunId} onSelectRun={selectRun} />

      <section className="workspace-grid">
        <aside className="runs-panel" aria-busy={loadingRuns}>
          <div className="panel-heading">
            <h2>Runs</h2>
            <span>{loadingRuns ? "loading" : `${runs.length} loaded · ${activeRunCount} active`}</span>
          </div>
          <FilterBar filters={runFilters} runs={runs} onApply={setRunFilters} />
          <RunList
            filtered={filtered}
            onClearFilters={() => setRunFilters({})}
            onSelectRun={selectRun}
            runs={runs}
            selectedRunId={selectedRunId}
          />
        </aside>

        <RunDetailPanel
          loading={loadingDetail}
          onBackToRuns={() => setMobileDetailOpen(false)}
          run={selectedRun ?? selectedRunSummary}
        />
      </section>
    </main>
  );
}
