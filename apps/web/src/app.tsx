import { useEffect, useState } from "react";

import { AppShell, type AppShellMode } from "./components/app-shell";
import { RunReader } from "./components/run-reader";
import { ApiError, createApiClient, type RunDetail, type RunListItem } from "./lib/api-client";
import { useKeyboardShortcut } from "./lib/use-keyboard-shortcut";

const api = createApiClient();
const LIVE_REFRESH_MS = 15_000;

export function App() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [readerNow, setReaderNow] = useState(() => new Date());
  const [mode, setMode] = useState<AppShellMode>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "observatory"
      ? "observatory"
      : "reader",
  );

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

  function setModeFromShell(nextMode: AppShellMode) {
    const next = new URLSearchParams(window.location.search);
    if (nextMode === "observatory") {
      next.set("view", "observatory");
    } else {
      next.delete("view");
    }

    const query = next.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    setMode(nextMode);
  }

  async function loadSelectedRun(runId: string, clearBeforeLoad = true) {
    if (clearBeforeLoad) {
      setSelectedRun(null);
    }

    try {
      const run = await api.getRun(runId);
      setAuthRequired(false);
      setSelectedRun(run);
    } catch (loadError) {
      if (clearBeforeLoad) {
        setSelectedRun(null);
      }
      handleLoadError(loadError, "Failed to load run");
    }
  }

  async function loadRuns(refreshDetail = false) {
    setLoadingRuns(true);
    setError(null);

    try {
      const items = await api.listRuns({ limit: 25 });
      const syncedAt = new Date();
      setAuthRequired(false);
      setRuns(items);
      setReaderNow(syncedAt);

      const nextSelectedRunId =
        selectedRunId && items.some((run) => run.id === selectedRunId) ? selectedRunId : null;

      setSelectedRunId(nextSelectedRunId);
      if (refreshDetail && nextSelectedRunId) {
        await loadSelectedRun(nextSelectedRunId, false);
      } else if (!nextSelectedRunId) {
        setSelectedRun(null);
      }
    } catch (loadError) {
      handleLoadError(loadError, "Failed to load runs");
    } finally {
      setLoadingRuns(false);
    }
  }

  useEffect(() => {
    void loadRuns(false);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadRuns(true);
    }, LIVE_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }

    let active = true;
    setSelectedRun(null);

    api
      .getRun(selectedRunId)
      .then((run) => {
        if (active) setSelectedRun(run);
      })
      .catch((loadError) => {
        if (active) {
          setSelectedRun(null);
          handleLoadError(loadError, "Failed to load run");
        }
      });

    return () => {
      active = false;
    };
  }, [selectedRunId]);

  useEffect(() => {
    const runIdFromUrl = new URLSearchParams(window.location.search).get("run");
    if (runIdFromUrl && runIdFromUrl !== selectedRunId) {
      setSelectedRunId(runIdFromUrl);
    }
  }, [selectedRunId]);

  useKeyboardShortcut("escape", () => {
    if (selectedRunId) {
      setSelectedFromDrawer(null);
    }
  });

  const drawerRun = selectedRun && selectedRun.id === selectedRunId ? selectedRun : null;

  return (
    <>
      <AppShell
        error={authRequired ? null : error}
        loading={loadingRuns}
        mode={mode}
        now={readerNow}
        onModeChange={setModeFromShell}
        onSelectRun={setSelectedFromDrawer}
        runs={runs}
        selectedRunId={selectedRunId}
      />
      {authRequired ? (
        <div className="auth-required" role="status">
          <span>Sign in to view your runs.</span>
          <a href="/auth/login">Sign in</a>
        </div>
      ) : null}
      {drawerRun ? (
        <div className="run-reader-overlay run-reader-overlay-visible">
          <RunReader detail={drawerRun} now={readerNow} onClose={() => setSelectedFromDrawer(null)} />
        </div>
      ) : null}
    </>
  );

  function handleLoadError(loadError: unknown, fallback: string) {
    if (loadError instanceof ApiError && loadError.code === "unauthorized") {
      setAuthRequired(true);
      setError(null);
      setRuns([]);
      setSelectedRun(null);
      setSelectedRunId(null);
      const next = new URLSearchParams(window.location.search);
      if (next.has("run")) {
        next.delete("run");
        const query = next.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      }
      return;
    }

    setError(loadError instanceof Error ? loadError.message : fallback);
  }
}
