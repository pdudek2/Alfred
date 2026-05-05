import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell, type AppShellMode } from "./components/app-shell";
import { RunReader } from "./components/run-reader";
import { createApiClient, isAuthError, type RunDetail, type RunListItem } from "./lib/api-client";
import { getSystemStatus } from "./lib/system-api-client";
import { buildSystemStatusVM, type SystemStatusSnapshot } from "./lib/system-status-view-model";
import { useKeyboardShortcut } from "./lib/use-keyboard-shortcut";

const api = createApiClient();
const LIVE_REFRESH_MS = 15_000;
const OPENING_RUN_SHELL_DELAY_MS = 180;

type UrlState = {
  mode: AppShellMode;
  selectedRunId: string | null;
};

type HistoryWriteMode = "push" | "replace";

function readUrlState(): UrlState {
  if (typeof window === "undefined") {
    return { mode: "reader", selectedRunId: null };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get("view") === "observatory" ? "observatory" : "reader",
    selectedRunId: params.get("run"),
  };
}

function writeUrlSearch(params: URLSearchParams, mode: HistoryWriteMode) {
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl === currentUrl) {
    return;
  }

  const write = mode === "push" ? window.history.pushState : window.history.replaceState;
  write.call(window.history, {}, "", nextUrl);
}

export function App() {
  const [initialUrlState] = useState(readUrlState);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => initialUrlState.selectedRunId);
  const selectedRunIdRef = useRef<string | null>(initialUrlState.selectedRunId);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [runLoadNotice, setRunLoadNotice] = useState<string | null>(null);
  const [readerNow, setReaderNow] = useState(() => new Date());
  const [lastRunsLoadedAt, setLastRunsLoadedAt] = useState<Date | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatusSnapshot>(null);
  const [mode, setMode] = useState<AppShellMode>(() => initialUrlState.mode);
  const [showOpeningRunShell, setShowOpeningRunShell] = useState(false);

  function setSelectedFromDrawer(runId: string | null) {
    const next = new URLSearchParams(window.location.search);
    if (runId) {
      next.set("run", runId);
    } else {
      next.delete("run");
    }

    writeUrlSearch(next, runId ? "push" : "replace");
    commitSelectedRunId(runId);
  }

  function commitSelectedRunId(runId: string | null) {
    selectedRunIdRef.current = runId;
    setSelectedRunId(runId);
  }

  function setModeFromShell(nextMode: AppShellMode) {
    const next = new URLSearchParams(window.location.search);
    if (nextMode === "observatory") {
      next.set("view", "observatory");
    } else {
      next.delete("view");
    }

    writeUrlSearch(next, "push");
    setMode(nextMode);
  }

  async function loadSelectedRun(runId: string, clearBeforeLoad = true) {
    if (clearBeforeLoad) {
      setSelectedRun(null);
    }
    setRunLoadNotice(null);

    try {
      const run = await api.getRun(runId);
      setAuthRequired(false);
      setSelectedRun(run);
    } catch (loadError) {
      if (clearBeforeLoad) {
        setSelectedRun(null);
      }
      handleRunDetailError(loadError);
    }
  }

  async function loadRuns(refreshDetail = false) {
    setLoadingRuns(true);
    setError(null);
    setRunLoadNotice(null);

    try {
      const items = await api.listRuns({ limit: 25 });
      const syncedAt = new Date();
      setAuthRequired(false);
      setRuns(items);
      setReaderNow(syncedAt);
      setLastRunsLoadedAt(syncedAt);

      const currentSelectedRunId = selectedRunIdRef.current;
      const nextSelectedRunId =
        currentSelectedRunId && items.some((run) => run.id === currentSelectedRunId) ? currentSelectedRunId : null;

      commitSelectedRunId(nextSelectedRunId);
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

  async function loadSystemStatus() {
    try {
      setSystemStatus(await getSystemStatus());
    } catch {
      setSystemStatus({ kind: "unavailable" });
    }
  }

  useEffect(() => {
    void loadRuns(false);
    void loadSystemStatus();
  }, []);

  useEffect(() => {
    function syncFromUrl() {
      const next = readUrlState();
      setMode(next.mode);
      commitSelectedRunId(next.selectedRunId);
      if (!next.selectedRunId) {
        setSelectedRun(null);
        setRunLoadNotice(null);
      }
    }

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadRuns(true);
      void loadSystemStatus();
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
          handleRunDetailError(loadError);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedRunId]);

  useKeyboardShortcut("escape", () => {
    if (selectedRunId) {
      setSelectedFromDrawer(null);
    }
  });

  const drawerRun = selectedRun && selectedRun.id === selectedRunId ? selectedRun : null;
  const openingRun = selectedRunId !== null && drawerRun === null;
  const showOpeningRun = openingRun && showOpeningRunShell;
  const systemStatusVM = useMemo(() => buildSystemStatusVM(systemStatus), [systemStatus]);

  useEffect(() => {
    if (!openingRun) {
      setShowOpeningRunShell(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowOpeningRunShell(true);
    }, OPENING_RUN_SHELL_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [openingRun]);

  return (
    <>
      <AppShell
        error={authRequired ? null : error}
        loading={loadingRuns}
        lastLoadedAt={lastRunsLoadedAt}
        mode={mode}
        now={readerNow}
        notice={runLoadNotice}
        onModeChange={setModeFromShell}
        onSelectRun={setSelectedFromDrawer}
        runs={runs}
        selectedRunId={selectedRunId}
        systemStatus={systemStatusVM}
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
      ) : showOpeningRun ? (
        <div className="run-reader-overlay run-reader-overlay-visible">
          <aside
            aria-labelledby="run-reader-opening-title"
            aria-modal="true"
            className="run-reader run-reader-opening"
            role="dialog"
          >
            <p className="run-reader-kicker">Loading</p>
            <h2 id="run-reader-opening-title">Opening run...</h2>
            <p className="run-reader-subtitle">Fetching the event stream.</p>
          </aside>
        </div>
      ) : null}
    </>
  );

  function handleLoadError(loadError: unknown, fallback: string) {
    if (isAuthError(loadError)) {
      setAuthRequired(true);
      setError(null);
      setRunLoadNotice(null);
      setRuns([]);
      setLastRunsLoadedAt(null);
      setSelectedRun(null);
      commitSelectedRunId(null);
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

  function handleRunDetailError(loadError: unknown) {
    if (isAuthError(loadError)) {
      handleLoadError(loadError, "Failed to load run");
      return;
    }

    setSelectedFromDrawer(null);
    setSelectedRun(null);
    setRunLoadNotice("I couldn't open that run. The feed is still usable.");
  }
}
