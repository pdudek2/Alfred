import { Pause, Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FilterBar } from "./components/filter-bar";
import { RunDetailPanel } from "./components/run-detail";
import { RunList } from "./components/run-list";
import { createApiClient, type RunDetail, type RunFilters, type RunListItem } from "./lib/api-client";
import { formatDateTime } from "./lib/time";

const api = createApiClient();
const LIVE_REFRESH_MS = 15_000;

function hasActiveFilters(filters: RunFilters) {
  return Object.values(filters).some((value) => value !== undefined && value.trim() !== "");
}

function isActiveRun(run: RunListItem) {
  return run.status === "running" || run.status === "waiting";
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

  const selectedRunSummary = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const activeRunCount = useMemo(() => runs.filter(isActiveRun).length, [runs]);
  const filtered = hasActiveFilters(runFilters);

  async function loadSelectedRun(runId: string) {
    setLoadingDetail(true);
    setSelectedRun(null);

    try {
      const run = await api.getRun(runId);
      setSelectedRun(run);
    } catch (loadError) {
      setSelectedRun(null);
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
      setRuns(items);
      setLastSyncedAt(new Date().toISOString());
      const nextSelectedRunId =
        selectedRunId && items.some((run) => run.id === selectedRunId)
          ? selectedRunId
          : (items[0]?.id ?? null);

      setSelectedRunId(nextSelectedRunId);
      if (refreshDetail && nextSelectedRunId) {
        await loadSelectedRun(nextSelectedRunId);
      } else if (!nextSelectedRunId) {
        setSelectedRun(null);
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

  return (
    <main className="app-shell">
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

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace-grid">
        <aside className="runs-panel">
          <div className="panel-heading">
            <h2>Runs</h2>
            <span>{loadingRuns ? "loading" : `${runs.length} loaded · ${activeRunCount} active`}</span>
          </div>
          <FilterBar filters={runFilters} runs={runs} onApply={setRunFilters} />
          <RunList
            filtered={filtered}
            onClearFilters={() => setRunFilters({})}
            onSelectRun={setSelectedRunId}
            runs={runs}
            selectedRunId={selectedRunId}
          />
        </aside>

        <RunDetailPanel run={selectedRun ?? selectedRunSummary} loading={loadingDetail} />
      </section>
    </main>
  );
}
