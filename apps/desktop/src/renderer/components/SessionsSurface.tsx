import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  TRANSCRIPT_TEXT_LIMIT,
  SESSIONS_PAGE_SIZE,
  type ExternalSessionSummary,
  type SessionSummary,
  type SessionsApi,
  type SessionsProjectInput,
  type TranscriptBlock,
  type TranscriptPage,
} from "../../shared/sessions-ipc";
import { terminalOutputLines } from "../../shared/session-title";
import type { TerminalApi } from "../../shared/terminal-ipc";
import {
  buildSessionsProjection,
  sessionsPrimaryAction,
  type SessionsPrimaryActionRequest,
} from "../sessions-projection";
import { sessionInstanceKey, type SessionTile } from "../session-state";
import { isReviewableWorktreeSession } from "../session-scope";
import { SESSION_STATE_LABELS, sessionState, type SessionDisplayStatus } from "../session-status";
import { sessionRelaunchSafety } from "../relaunch-safety";
import { appendTranscriptPage, type SessionsViewState } from "../sessions-view-state";
import { historySummarySentence, type HistorySelection } from "../history-presentation";
import { SessionsNavigator } from "./SessionsNavigator";
import "./history.css";
import {
  SessionsReader,
  type SessionsReaderEmptyState,
  type SessionsReaderStatus,
} from "./SessionsReader";

const SAVED_ACTION_RESULT_TITLES = new Set([
  "Applied to project",
  "Apply failed",
  "Apply needs review",
  "Checkout diff reviewed",
  "Discard checkout blocked",
  "Review diff failed",
]);

// A transcript Alfred did not run has no process to report on; it reads as ended.
const ENDED_STATUS: SessionDisplayStatus = { kind: "done", label: SESSION_STATE_LABELS.done };

export type SessionsSurfaceProps = {
  externalSessionIndexingEnabled: boolean;
  armedRecoverySessionIds: ReadonlySet<string>;
  externalSessions: ExternalSessionSummary[];
  externalSessionsError: string | null;
  loadingExternalSessions: boolean;
  now: number;
  sessions: SessionTile[];
  sessionsApi: SessionsApi | null;
  state: SessionsViewState;
  terminalApi: Pick<TerminalApi, "snapshot"> | null;
  worktreeActionPending?: Readonly<Record<string, "review" | "apply" | undefined>>;
  workspaces: SessionsProjectInput[];
  onApplyWorktree?: (sessionId: string) => void;
  onBackToWork: () => void;
  onDiscardSavedSession?: (sessionId: string) => void;
  onOpenPrivacySettings?: () => void;
  onPrimaryAction: ((request: SessionsPrimaryActionRequest) => void) | undefined;
  onRefreshExternalSessions: () => void;
  onReviewWorktree?: (sessionId: string) => void;
  onSelectionChange?: (selection: HistorySelection | null) => void;
  onStateChange: Dispatch<SetStateAction<SessionsViewState>>;
};

export function SessionsSurface({
  externalSessionIndexingEnabled,
  armedRecoverySessionIds,
  externalSessions,
  externalSessionsError,
  loadingExternalSessions,
  now,
  sessions,
  sessionsApi,
  state,
  terminalApi,
  worktreeActionPending,
  workspaces,
  onApplyWorktree,
  onBackToWork,
  onDiscardSavedSession,
  onOpenPrivacySettings,
  onPrimaryAction,
  onRefreshExternalSessions,
  onReviewWorktree,
  onSelectionChange,
  onStateChange,
}: SessionsSurfaceProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const navigatorRef = useRef<HTMLDivElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const initialFocusTargetRef = useRef(state.focusTarget);
  const requestSequenceRef = useRef(0);
  const reconciliationKey = [
    state.selectedProjectId,
    state.source,
    state.query,
    state.pageIndex,
  ].join("\u0000");
  const previousReconciliationKeyRef = useRef(reconciliationKey);
  // A selection without pages was made from outside (the deck's Asleep line) and loads on mount.
  const presetSelectionRef = useRef(state.readerPages.length === 0 ? state.selectedSessionKey : null);
  const [readerStatus, setReaderStatus] = useState<SessionsReaderStatus>(
    state.readerPages.length > 0 ? "ready" : state.selectedSessionKey ? "loading" : "idle",
  );
  const [readerPageError, setReaderPageError] = useState<string | null>(null);
  // Drafts are plan items, not sessions that ran: they have no place in the archive.
  const ranSessions = useMemo(() => sessions.filter((session) => session.stage !== "staged"), [sessions]);
  const projection = useMemo(
    () => {
      // A project's scope is everything launched in it, wherever a session's own folder was. This is the
      // set the deck's Asleep line counts, so the line and the list it opens agree.
      const projectId = state.selectedProjectId;
      const oneProject = projectId !== "all" && projectId !== "free-chats";
      const managed = oneProject ? ranSessions.filter((session) => session.workspaceId === projectId) : ranSessions;
      const external = oneProject ? externalSessions.filter((session) => session.project.id === projectId) : externalSessions;
      return buildSessionsProjection({
        sessions: state.source === "external-codex" ? [] : managed,
        workspaces,
        externalSessions: state.source === "managed" ? [] : external,
        query: state.query,
        pageIndex: state.pageIndex,
        projectId: oneProject ? "all" : projectId,
      });
    },
    [externalSessions, ranSessions, state.pageIndex, state.query, state.selectedProjectId, state.source, workspaces],
  );
  const projectProjection = useMemo(
    () => buildSessionsProjection({
      sessions: ranSessions,
      workspaces,
      externalSessions,
      projectId: "all",
    }),
    [externalSessions, ranSessions, workspaces],
  );
  const statusByKey = useMemo(() => {
    const statuses = new Map<string, SessionDisplayStatus>();
    for (const item of projection.items) {
      const target = projection.managedTargets.get(item.sessionKey);
      const session = target
        ? sessions.find((candidate) => candidate.id === target.sessionId && candidate.workspaceId === target.workspaceId)
        : undefined;
      statuses.set(item.sessionKey, session ? sessionState(session, "ready", now) : ENDED_STATUS);
    }
    return statuses;
  }, [now, projection.items, projection.managedTargets, sessions]);
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(
    state.selectedSessionKey ?? projection.items[0]?.sessionKey ?? null,
  );
  const projectedSelected = projection.items.find((item) => item.sessionKey === state.selectedSessionKey) ?? null;
  const [selectedSummary, setSelectedSummary] = useState<SessionSummary | null>(projectedSelected);
  const selectionInProjection = Boolean(
    state.selectedSessionKey
    && projection.items.some((item) => item.sessionKey === state.selectedSessionKey),
  );
  const selected = selectionInProjection
    ? projectedSelected ?? (selectedSummary?.sessionKey === state.selectedSessionKey ? selectedSummary : null)
    : null;
  const selectedManagedTarget = selected
    ? projection.managedTargets.get(selected.sessionKey)
      ?? managedTargetForSummary(selected, sessions)
    : null;
  const selectedManagedSession = selectedManagedTarget
    ? sessions.find((item) => (
        item.id === selectedManagedTarget.sessionId
        && item.workspaceId === selectedManagedTarget.workspaceId
      )) ?? null
    : null;
  const selectedRecoverySafety = selected?.lifecycle === "recoverable" && selectedManagedSession
    ? sessionRelaunchSafety(selectedManagedSession)
    : null;
  const selectedRecoveryArmed = Boolean(
    selectedManagedTarget && armedRecoverySessionIds.has(selectedManagedTarget.sessionId),
  );
  const discardSelectionRef = useRef<{ key: string; index: number } | null>(null);
  const selectedSavedActions = selectedManagedSession
    && ["restored", "exited", "error"].includes(selectedManagedSession.runtimeStatus ?? "")
    && onDiscardSavedSession
    ? {
        ended: selectedManagedSession.runtimeStatus !== "restored",
        confirmInline: !isReviewableWorktreeSession(selectedManagedSession),
        checkout: isReviewableWorktreeSession(selectedManagedSession)
          && Boolean(onApplyWorktree && onReviewWorktree),
        pendingAction: worktreeActionPending?.[sessionInstanceKey(selectedManagedSession)],
        onApply: () => onApplyWorktree?.(selectedManagedSession.id),
        onDiscard: () => {
          discardSelectionRef.current = {
            key: selected!.sessionKey,
            index: projection.items.findIndex((item) => item.sessionKey === selected!.sessionKey),
          };
          onDiscardSavedSession(selectedManagedSession.id);
        },
        onReview: () => onReviewWorktree?.(selectedManagedSession.id),
      }
    : null;
  const selectedSavedActionEvent = selectedManagedSession?.activityEvents
    ? [...selectedManagedSession.activityEvents]
        .reverse()
        .find((event) => SAVED_ACTION_RESULT_TITLES.has(event.title)) ?? null
    : null;
  const primaryActionRequest = useMemo<SessionsPrimaryActionRequest | null>(() => {
    if (!selected || !onPrimaryAction) return null;
    let action = sessionsPrimaryAction(selected);
    if (!action) return null;
    const target = selectedManagedTarget;
    if (selected.source === "managed" && !target) return null;
    if (action.kind === "recover" && selectedRecoverySafety && !selectedRecoverySafety.safe) {
      action = {
        kind: "recover",
        label: selectedRecoveryArmed ? "Confirm resume" : "Review resume",
      };
    }
    return {
      action,
      summary: { ...selected, project: { ...selected.project } },
      target,
    };
  }, [onPrimaryAction, selected, selectedManagedTarget, selectedRecoveryArmed, selectedRecoverySafety]);

  const patchState = useCallback((patch: Partial<SessionsViewState>) => {
    onStateChange((current) => ({ ...current, ...patch }));
  }, [onStateChange]);
  const clearFilters = useCallback(() => {
    patchState({
      selectedProjectId: "all",
      source: "all",
      query: "",
      pageIndex: 0,
      navigatorScrollTop: 0,
    });
  }, [patchState]);
  const hasActiveFilters = Boolean(
    state.query.trim()
    || state.selectedProjectId !== "all"
    || state.source !== "all",
  );
  let emptyState: SessionsReaderEmptyState | null = null;
  if (!loadingExternalSessions && projection.items.length === 0) {
    if (hasActiveFilters) {
      emptyState = {
        title: "No sessions match these filters",
        detail: "Clear the project, source and search to see every session.",
        primaryAction: { label: "Clear filters", onClick: clearFilters },
      };
    } else if (!externalSessionIndexingEnabled) {
      emptyState = {
        title: "No sessions yet",
        detail: "Start a session in the deck, or turn on Codex history in Local Data & Privacy.",
        primaryAction: { label: "Go to Deck", onClick: onBackToWork },
        ...(onOpenPrivacySettings
          ? { secondaryAction: { label: "Open Local Data & Privacy", onClick: onOpenPrivacySettings } }
          : {}),
      };
    } else if (externalSessionsError) {
      emptyState = {
        title: "Codex history couldn't be loaded",
        detail: "Start a session in the deck, or try loading history again.",
        primaryAction: { label: "Go to Deck", onClick: onBackToWork },
        secondaryAction: { label: "Try again", onClick: onRefreshExternalSessions },
      };
    } else {
      emptyState = {
        title: "No sessions yet",
        detail: "Start a session in the deck. Live and ended sessions appear here.",
        primaryAction: { label: "Go to Deck", onClick: onBackToWork },
      };
    }
  }

  useEffect(() => {
    const target = initialFocusTargetRef.current === "results"
      ? navigatorRef.current
      : initialFocusTargetRef.current === "reader"
        ? readerRef.current
        : searchRef.current;
    target?.focus();
  }, []);

  useEffect(() => {
    if (!projection.items.some((item) => item.sessionKey === activeSessionKey)) {
      setActiveSessionKey(projection.items[0]?.sessionKey ?? null);
    }
  }, [activeSessionKey, projection.items]);

  useEffect(() => {
    if (projectedSelected) {
      setSelectedSummary(projectedSelected);
    } else {
      setSelectedSummary(null);
    }
  }, [projectedSelected, state.selectedSessionKey]);

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

  const selectSession = useCallback(async (
    summary: SessionSummary,
    readerMode: SessionsViewState["readerMode"] = "conversation",
  ) => {
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    setSelectedSummary(summary);
    onStateChange((current) => ({
      ...current,
      selectedSessionKey: summary.sessionKey,
      readerPages: [],
      readerScrollTop: 0,
      readerMode,
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
          ...(readerMode === "raw" ? { mode: "raw" as const } : {}),
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

  useEffect(() => {
    const selectedSessionMissing = state.selectedSessionKey !== null
      && !projection.items.some((item) => item.sessionKey === state.selectedSessionKey);
    if (previousReconciliationKeyRef.current === reconciliationKey && !selectedSessionMissing) return;
    previousReconciliationKeyRef.current = reconciliationKey;
    if (projection.items.some((item) => item.sessionKey === state.selectedSessionKey)) return;
    const discarded = selectedSessionMissing && discardSelectionRef.current?.key === state.selectedSessionKey
      ? discardSelectionRef.current : null;
    if (discarded && projection.items.length === 0 && state.pageIndex > 0) {
      discardSelectionRef.current = { ...discarded, index: SESSIONS_PAGE_SIZE - 1 };
      onStateChange((current) => ({ ...current, pageIndex: current.pageIndex - 1 }));
      return;
    }
    discardSelectionRef.current = null;
    const first = projection.items[discarded ? Math.min(discarded.index, projection.items.length - 1) : 0];
    if (discarded) {
      setActiveSessionKey(first?.sessionKey ?? null);
      navigatorRef.current?.focus();
    }
    if (first) {
      void selectSession(first);
      return;
    }
    requestSequenceRef.current += 1;
    setSelectedSummary(null);
    setReaderStatus("idle");
    setReaderPageError(null);
    onStateChange((current) => {
      if (current.selectedSessionKey === null && current.readerPages.length === 0 && current.readerScrollTop === 0) {
        return current;
      }
      return {
        ...current,
        selectedSessionKey: null,
        readerPages: [],
        readerScrollTop: 0,
      };
    });
  }, [onStateChange, projection.items, reconciliationKey, selectSession, state.pageIndex, state.selectedSessionKey]);

  useEffect(() => {
    const presetKey = presetSelectionRef.current;
    presetSelectionRef.current = null;
    const preset = presetKey ? projection.items.find((item) => item.sessionKey === presetKey) : undefined;
    if (preset) void selectSession(preset);
  }, [projection.items, selectSession]);

  const selectedStatus = selected ? statusByKey.get(selected.sessionKey) ?? ENDED_STATUS : null;
  const selectedTitle = selected?.title ?? null;
  useEffect(() => {
    onSelectionChange?.(selectedTitle !== null && selectedStatus ? { title: selectedTitle, status: selectedStatus } : null);
  }, [onSelectionChange, selectedStatus, selectedTitle]);
  useEffect(() => () => onSelectionChange?.(null), [onSelectionChange]);

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
        ...(state.readerMode === "raw" ? { mode: "raw" as const } : {}),
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
  }, [onStateChange, selected, sessionsApi, state.readerMode, state.readerPages]);

  return (
    <section
      className="sessions-surface"
      aria-label="History"
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
        projectCounts={projectProjection.projectCounts}
        searchRef={searchRef}
        showControls={loadingExternalSessions || projection.total > 0 || hasActiveFilters}
        state={state}
        statusByKey={statusByKey}
        now={now}
        workspaces={workspaces}
        onActiveSessionKeyChange={setActiveSessionKey}
        onOpenPrivacySettings={onOpenPrivacySettings}
        onRefreshExternalSessions={onRefreshExternalSessions}
        onSelectSession={(summary) => void selectSession(summary)}
        onSelectProject={(selectedProjectId) => {
          patchState({
            selectedProjectId,
            query: "",
            pageIndex: 0,
            navigatorScrollTop: 0,
          });
        }}
        onFocusTargetChange={(focusTarget) => patchState({ focusTarget })}
        onStatePatch={patchState}
      />
      <SessionsReader
        pages={state.readerPages}
        primaryAction={primaryActionRequest?.action ?? null}
        savedActionFeedback={selectedSavedActionEvent
          ? {
              detail: selectedSavedActionEvent.detail,
              title: selectedSavedActionEvent.title,
              warning: selectedSavedActionEvent.kind === "error" || selectedSavedActionEvent.kind === "warning",
            }
          : null}
        savedActions={selectedSavedActions}
        recoveryReview={
          selectedRecoveryArmed && selectedManagedSession && selectedRecoverySafety && !selectedRecoverySafety.safe
            ? {
                command: [selectedManagedSession.command, ...(selectedManagedSession.args ?? [])]
                  .filter(Boolean)
                  .join(" "),
                cwd: selectedManagedSession.cwd,
                reason: selectedRecoverySafety.reason,
              }
            : null
        }
        readerRef={readerRef}
        selected={selected}
        summary={selected && selectedStatus ? historySummarySentence(selected, selectedStatus.kind, now) : null}
        emptyState={emptyState}
        status={readerStatus}
        pageError={readerPageError}
        readerMode={state.readerMode}
        canReadRaw={Boolean(selected && (selected.source === "external-codex" || selected.contentSessionKey))}
        onLoadMore={() => void loadMore()}
        onRetryTranscript={() => {
          if (selected) void selectSession(selected);
        }}
        onPrimaryAction={() => {
          if (primaryActionRequest) onPrimaryAction?.(primaryActionRequest);
        }}
        onReaderModeChange={(readerMode) => {
          if (selected) void selectSession(selected, readerMode);
        }}
        onScrollTopChange={(readerScrollTop) => patchState({ readerScrollTop })}
        onFocus={() => patchState({ focusTarget: "reader" })}
      />
    </section>
  );
}

function managedTargetForSummary(
  summary: SessionSummary,
  sessions: SessionTile[],
): { workspaceId: string; sessionId: string } | null {
  if (summary.source !== "managed" || !summary.sessionKey.startsWith("managed:")) return null;
  const sessionId = summary.sessionKey.slice("managed:".length);
  const session = sessions.find((item) => item.id === sessionId);
  return session ? { workspaceId: session.workspaceId, sessionId: session.id } : null;
}

async function readManagedTranscript(
  session: SessionTile | null,
  terminalApi: Pick<TerminalApi, "snapshot"> | null,
): Promise<string | null> {
  if (!session) return null;
  if (session.runtimeStatus === "restored") return session.initialBuffer ?? null;
  if (session.runtimeId && terminalApi) {
    return (await terminalApi.snapshot({ id: session.runtimeId }))?.buffer ?? session.initialBuffer ?? null;
  }
  return session.initialBuffer ?? null;
}

function terminalTranscriptPage(
  sessionKey: string,
  rawText: string,
  session: SessionTile | null,
): TranscriptPage {
  // Terminal manager bounds live and persisted snapshots below this reader's text ceiling,
  // so reading the whole output first cannot create an unbounded renderer copy or split a sequence.
  const bounded = tailUtf8(terminalOutputLines(rawText).join("\n"), TRANSCRIPT_TEXT_LIMIT);
  const lines = bounded.text.split("\n");
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

