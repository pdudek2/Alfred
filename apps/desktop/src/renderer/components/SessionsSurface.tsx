import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  TRANSCRIPT_TEXT_LIMIT,
  type ExternalSessionSummary,
  type SessionSummary,
  type SessionsApi,
  type SessionsProjectInput,
  type TranscriptBlock,
  type TranscriptPage,
} from "../../shared/sessions-ipc";
import type { TerminalApi } from "../../shared/terminal-ipc";
import { buildSessionsProjection } from "../sessions-projection";
import type { SessionTile } from "../session-state";
import { appendTranscriptPage, type SessionsViewState } from "../sessions-view-state";
import { SessionsNavigator } from "./SessionsNavigator";
import { SessionsReader, type SessionsReaderStatus } from "./SessionsReader";

export type SessionsSurfaceProps = {
  externalSessionIndexingEnabled: boolean;
  externalSessions: ExternalSessionSummary[];
  externalSessionsError: string | null;
  loadingExternalSessions: boolean;
  sessions: SessionTile[];
  sessionsApi: SessionsApi | null;
  state: SessionsViewState;
  terminalApi: Pick<TerminalApi, "snapshot"> | null;
  workspaces: SessionsProjectInput[];
  onBackToWork: () => void;
  onOpenManagedSession: (workspaceId: string, sessionId: string) => void;
  onRefreshExternalSessions: () => void;
  onResumeExternalCodexSession: (sessionKey: string) => void;
  onStateChange: Dispatch<SetStateAction<SessionsViewState>>;
  onTrustExternalCodexWorkspace?: (sessionKey: string) => void;
};

export function SessionsSurface({
  externalSessionIndexingEnabled,
  externalSessions,
  externalSessionsError,
  loadingExternalSessions,
  sessions,
  sessionsApi,
  state,
  terminalApi,
  workspaces,
  onBackToWork,
  onOpenManagedSession,
  onRefreshExternalSessions,
  onResumeExternalCodexSession,
  onStateChange,
  onTrustExternalCodexWorkspace,
}: SessionsSurfaceProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const navigatorRef = useRef<HTMLDivElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const requestSequenceRef = useRef(0);
  const reducedMotion = usePrefersReducedMotion();
  const [readerStatus, setReaderStatus] = useState<SessionsReaderStatus>(
    state.readerPages.length > 0 ? "ready" : state.selectedSessionKey ? "missing" : "idle",
  );
  const filteredSessions = useMemo(
    () => filterManagedSessions(sessions, state.source, state.timeRange),
    [sessions, state.source, state.timeRange],
  );
  const filteredExternalSessions = useMemo(
    () => filterExternalSessions(externalSessions, state.source, state.timeRange),
    [externalSessions, state.source, state.timeRange],
  );
  const projection = useMemo(
    () => buildSessionsProjection({
      sessions: filteredSessions,
      workspaces,
      externalSessions: filteredExternalSessions,
      query: state.query,
      pageIndex: state.pageIndex,
    }),
    [filteredExternalSessions, filteredSessions, state.pageIndex, state.query, workspaces],
  );
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(
    state.selectedSessionKey ?? projection.items[0]?.sessionKey ?? null,
  );
  const selected = projection.items.find((item) => item.sessionKey === state.selectedSessionKey) ?? null;

  const patchState = useCallback((patch: Partial<SessionsViewState>) => {
    onStateChange((current) => ({ ...current, ...patch }));
  }, [onStateChange]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!projection.items.some((item) => item.sessionKey === activeSessionKey)) {
      setActiveSessionKey(projection.items[0]?.sessionKey ?? null);
    }
  }, [activeSessionKey, projection.items]);

  useEffect(() => {
    if (navigatorRef.current) navigatorRef.current.scrollTop = state.navigatorScrollTop;
    if (readerRef.current) readerRef.current.scrollTop = state.readerScrollTop;
  }, []);

  useEffect(() => {
    const handleFind = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", handleFind);
    return () => window.removeEventListener("keydown", handleFind);
  }, []);

  useEffect(() => () => {
    requestSequenceRef.current += 1;
  }, []);

  useEffect(() => {
    const selectedExternalSession = state.selectedSessionKey?.startsWith("external-codex:") ?? false;
    const hasExternalReaderPages = state.readerPages.some((page) => page.sessionKey.startsWith("external-codex:"));
    if (externalSessionIndexingEnabled || (!selectedExternalSession && !hasExternalReaderPages)) return;
    requestSequenceRef.current += 1;
    onStateChange((current) => ({
      ...current,
      selectedSessionKey: selectedExternalSession ? null : current.selectedSessionKey,
      readerPages: [],
      readerScrollTop: 0,
    }));
    setReaderStatus(selectedExternalSession ? "idle" : "missing");
  }, [externalSessionIndexingEnabled, onStateChange, state.readerPages, state.selectedSessionKey]);

  const selectSession = useCallback(async (summary: SessionSummary) => {
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    onStateChange((current) => ({
      ...current,
      selectedSessionKey: summary.sessionKey,
      readerPages: [],
      readerScrollTop: 0,
    }));
    setReaderStatus("loading");

    try {
      if (summary.source === "external-codex" || summary.contentSessionKey) {
        if (!sessionsApi) {
          setReaderStatus("error");
          return;
        }
        const page = await sessionsApi.readTranscriptPage({
          sessionKey: summary.contentSessionKey ?? summary.sessionKey,
        });
        if (requestSequenceRef.current !== requestSequence) return;
        if (page.blocks.length === 0 && page.nextCursor === null) {
          setReaderStatus("missing");
          return;
        }
        onStateChange((current) => ({ ...current, readerPages: [page] }));
        setReaderStatus("ready");
        return;
      }

      if (summary.source === "managed") {
        const target = projection.managedTargets.get(summary.sessionKey);
        const session = target
          ? sessions.find((item) => item.id === target.sessionId && item.workspaceId === target.workspaceId) ?? null
          : null;
        const text = await readManagedTranscript(session ?? null, terminalApi);
        if (requestSequenceRef.current !== requestSequence) return;
        if (text === null || text.length === 0) {
          setReaderStatus("missing");
          return;
        }
        const page = terminalTranscriptPage(summary.sessionKey, text, session);
        onStateChange((current) => ({ ...current, readerPages: [page] }));
        setReaderStatus("ready");
        return;
      }

      setReaderStatus("error");
    } catch {
      if (requestSequenceRef.current === requestSequence) setReaderStatus("error");
    }
  }, [onStateChange, projection.managedTargets, sessions, sessionsApi, terminalApi]);

  const loadMore = useCallback(async () => {
    if (!selected || !sessionsApi || (selected.source !== "external-codex" && !selected.contentSessionKey)) return;
    const cursor = state.readerPages.at(-1)?.nextCursor;
    if (!cursor) return;
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    try {
      const page = await sessionsApi.readTranscriptPage({
        sessionKey: selected.contentSessionKey ?? selected.sessionKey,
        cursor,
      });
      if (requestSequenceRef.current !== requestSequence) return;
      onStateChange((current) => appendTranscriptPage(current, page));
      setReaderStatus("ready");
    } catch {
      if (requestSequenceRef.current === requestSequence) setReaderStatus("error");
    }
  }, [onStateChange, selected, sessionsApi, state.readerPages]);

  const runPrimaryAction = useCallback((summary: SessionSummary) => {
    if (summary.source === "managed") {
      const target = projection.managedTargets.get(summary.sessionKey);
      if (target) onOpenManagedSession(target.workspaceId, target.sessionId);
      return;
    }
    if (summary.lifecycle === "resumable") {
      onResumeExternalCodexSession(summary.sessionKey);
    } else {
      onTrustExternalCodexWorkspace?.(summary.sessionKey);
    }
  }, [onOpenManagedSession, onResumeExternalCodexSession, onTrustExternalCodexWorkspace, projection.managedTargets]);

  return (
    <section
      className={`sessions-surface${reducedMotion ? " sessions-surface--reduced-motion" : ""}`}
      aria-label="Sessions workspace"
      data-secondary-chrome-height="36"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onBackToWork();
      }}
    >
      <SessionsNavigator
        activeSessionKey={activeSessionKey}
        externalSessionIndexingEnabled={externalSessionIndexingEnabled}
        externalSessionsError={externalSessionsError}
        loadingExternalSessions={loadingExternalSessions}
        navigatorRef={navigatorRef}
        projection={projection}
        searchRef={searchRef}
        state={state}
        onActiveSessionKeyChange={setActiveSessionKey}
        onBackToWork={onBackToWork}
        onRefreshExternalSessions={onRefreshExternalSessions}
        onSelectSession={(summary) => void selectSession(summary)}
        onStatePatch={patchState}
      />
      <SessionsReader
        pages={state.readerPages}
        readerRef={readerRef}
        selected={selected}
        status={readerStatus}
        onLoadMore={() => void loadMore()}
        onPrimaryAction={runPrimaryAction}
        onScrollTopChange={(readerScrollTop) => patchState({ readerScrollTop })}
      />
    </section>
  );
}

async function readManagedTranscript(
  session: SessionTile | null,
  terminalApi: Pick<TerminalApi, "snapshot"> | null,
): Promise<string | null> {
  if (!session) return null;
  if (session.runtimeStatus === "restored") return session.initialBuffer ?? null;
  if ((session.runtimeStatus === "live" || session.runtimeStatus === "starting") && session.runtimeId && terminalApi) {
    return (await terminalApi.snapshot({ id: session.runtimeId }))?.buffer ?? null;
  }
  return null;
}

function terminalTranscriptPage(
  sessionKey: string,
  rawText: string,
  session: SessionTile | null,
): TranscriptPage {
  const textWasTruncated = rawText.length > TRANSCRIPT_TEXT_LIMIT;
  const boundedText = rawText.slice(-TRANSCRIPT_TEXT_LIMIT).replace(/\r\n/g, "\n");
  const lines = boundedText.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const boundedLines = lines.slice(-120);
  const blocks: TranscriptBlock[] = boundedLines.map((text, index) => ({
    id: `${sessionKey}:terminal:${index}`,
    kind: "terminal",
    text,
  }));
  return {
    sessionKey,
    blocks,
    nextCursor: null,
    revision: `managed:${session?.runtimeId ?? session?.id ?? sessionKey}:${session?.lastOutputAt ?? session?.lastActivityAt ?? 0}`,
    partial: lines.length > boundedLines.length || textWasTruncated,
  };
}

function filterManagedSessions(
  sessions: SessionTile[],
  source: SessionsViewState["source"],
  timeRange: SessionsViewState["timeRange"],
): SessionTile[] {
  if (source === "external-codex") return [];
  const cutoff = timeRangeCutoff(timeRange);
  return sessions.filter((session) => (
    cutoff === null || (session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt ?? 0) >= cutoff
  ));
}

function filterExternalSessions(
  sessions: ExternalSessionSummary[],
  source: SessionsViewState["source"],
  timeRange: SessionsViewState["timeRange"],
): ExternalSessionSummary[] {
  if (source === "managed") return [];
  const cutoff = timeRangeCutoff(timeRange);
  return sessions.filter((session) => cutoff === null || session.updatedAt >= cutoff);
}

function timeRangeCutoff(timeRange: SessionsViewState["timeRange"]): number | null {
  if (timeRange === "any") return null;
  const days = timeRange === "day" ? 1 : timeRange === "week" ? 7 : 30;
  return Date.now() - days * 24 * 60 * 60 * 1_000;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}
