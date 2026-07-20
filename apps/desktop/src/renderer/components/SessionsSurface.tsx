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
import {
  buildSessionsProjection,
  sessionsPrimaryAction,
  type SessionsPrimaryActionRequest,
} from "../sessions-projection";
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
  onOpenPrivacySettings?: () => void;
  onPrimaryAction: ((request: SessionsPrimaryActionRequest) => void) | undefined;
  onRefreshExternalSessions: () => void;
  onStateChange: Dispatch<SetStateAction<SessionsViewState>>;
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
  onOpenPrivacySettings,
  onPrimaryAction,
  onRefreshExternalSessions,
  onStateChange,
}: SessionsSurfaceProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const navigatorRef = useRef<HTMLDivElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const requestSequenceRef = useRef(0);
  const reducedMotion = usePrefersReducedMotion();
  const [readerStatus, setReaderStatus] = useState<SessionsReaderStatus>(
    state.readerPages.length > 0 ? "ready" : state.selectedSessionKey ? "missing" : "idle",
  );
  const [readerPageError, setReaderPageError] = useState<string | null>(null);
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
  const primaryActionRequest = useMemo<SessionsPrimaryActionRequest | null>(() => {
    if (!selected || !onPrimaryAction) return null;
    const action = sessionsPrimaryAction(selected);
    if (!action) return null;
    const target = projection.managedTargets.get(selected.sessionKey) ?? null;
    if (selected.source === "managed" && !target) return null;
    return {
      action,
      summary: { ...selected, project: { ...selected.project } },
      target,
    };
  }, [onPrimaryAction, projection.managedTargets, selected]);

  const patchState = useCallback((patch: Partial<SessionsViewState>) => {
    onStateChange((current) => ({ ...current, ...patch }));
  }, [onStateChange]);

  useEffect(() => {
    const target = state.focusTarget === "results"
      ? navigatorRef.current
      : state.focusTarget === "reader"
        ? readerRef.current
        : searchRef.current;
    target?.focus();
  }, [state.focusTarget]);

  useEffect(() => {
    if (!projection.items.some((item) => item.sessionKey === activeSessionKey)) {
      setActiveSessionKey(projection.items[0]?.sessionKey ?? null);
    }
  }, [activeSessionKey, projection.items]);

  useEffect(() => {
    if (navigatorRef.current && navigatorRef.current.scrollTop !== state.navigatorScrollTop) {
      navigatorRef.current.scrollTop = state.navigatorScrollTop;
    }
    if (readerRef.current && readerRef.current.scrollTop !== state.readerScrollTop) {
      readerRef.current.scrollTop = state.readerScrollTop;
    }
  }, [state.navigatorScrollTop, state.readerScrollTop]);

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
    setReaderPageError(null);

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
    setReaderPageError(null);
    try {
      const page = await sessionsApi.readTranscriptPage({
        sessionKey: selected.contentSessionKey ?? selected.sessionKey,
        cursor,
      });
      if (requestSequenceRef.current !== requestSequence) return;
      onStateChange((current) => appendTranscriptPage(current, page));
      setReaderStatus("ready");
    } catch {
      if (requestSequenceRef.current === requestSequence) {
        setReaderStatus("ready");
        setReaderPageError("The next transcript page could not be loaded.");
      }
    }
  }, [onStateChange, selected, sessionsApi, state.readerPages]);

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
        onOpenPrivacySettings={onOpenPrivacySettings}
        onRefreshExternalSessions={onRefreshExternalSessions}
        onSelectSession={(summary) => void selectSession(summary)}
        onFocusTargetChange={(focusTarget) => patchState({ focusTarget })}
        onStatePatch={patchState}
      />
      <SessionsReader
        pages={state.readerPages}
        primaryAction={primaryActionRequest?.action ?? null}
        readerRef={readerRef}
        selected={selected}
        status={readerStatus}
        pageError={readerPageError}
        onLoadMore={() => void loadMore()}
        onRetryTranscript={() => {
          if (selected) void selectSession(selected);
        }}
        onPrimaryAction={() => {
          if (primaryActionRequest) onPrimaryAction?.(primaryActionRequest);
        }}
        onScrollTopChange={(readerScrollTop) => patchState({ readerScrollTop })}
        onFocus={() => patchState({ focusTarget: "reader" })}
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
  // Terminal manager bounds live and persisted snapshots below this reader's text ceiling,
  // so stripping CSI first cannot create an unbounded renderer copy or split a sequence.
  const bounded = tailUtf8(stripAnsiTerminalText(rawText), TRANSCRIPT_TEXT_LIMIT);
  const boundedText = bounded.text.replace(/\r\n/g, "\n");
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
    partial: lines.length > boundedLines.length || bounded.truncated,
  };
}

function tailUtf8(value: string, byteLimit: number): { text: string; truncated: boolean } {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= byteLimit) return { text: value, truncated: false };
  let start = encoded.byteLength - byteLimit;
  while (start < encoded.byteLength && (encoded[start]! & 0xc0) === 0x80) start += 1;
  return {
    text: new TextDecoder().decode(encoded.subarray(start)),
    truncated: true,
  };
}

function stripAnsiTerminalText(value: string): string {
  // Managed terminal snapshots may contain CSI control sequences (`ESC [` through the final byte).
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
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
