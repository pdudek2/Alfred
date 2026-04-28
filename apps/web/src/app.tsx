import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { RunDetailPanel } from "./components/run-detail";
import { RunList } from "./components/run-list";
import { createApiClient, type RunDetail, type RunListItem } from "./lib/api-client";

const api = createApiClient();

export function App() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRunSummary = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );

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

  async function loadRuns(refreshDetail = false) {
    setLoadingRuns(true);
    setError(null);

    try {
      const items = await api.listRuns(25);
      setRuns(items);
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
    void loadRuns();
  }, []);

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
        <button className="icon-button" onClick={() => void loadRuns(true)} type="button" aria-label="Refresh runs">
          <RefreshCw size={18} />
        </button>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace-grid">
        <aside className="runs-panel">
          <div className="panel-heading">
            <h2>Runs</h2>
            <span>{loadingRuns ? "loading" : `${runs.length} loaded`}</span>
          </div>
          <RunList runs={runs} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />
        </aside>

        <RunDetailPanel run={selectedRun ?? selectedRunSummary} loading={loadingDetail} />
      </section>
    </main>
  );
}
