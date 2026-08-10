import { useEffect, useRef, useState, type RefObject } from "react";
import type { SessionSummary, TranscriptBlock, TranscriptPage } from "../../shared/sessions-ipc";
import type { SessionsPrimaryAction } from "../sessions-projection";

export type SessionsReaderStatus = "idle" | "loading" | "ready" | "missing" | "error";

export type SessionsReaderEmptyState = {
  title: string;
  detail: string;
  primaryAction: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
};

export type SessionsSavedActions = {
  checkout: boolean;
  pendingAction?: "review" | "apply" | undefined;
  onApply: () => void;
  onDiscard: () => void;
  onReview: () => void;
};

export type SessionsSavedActionFeedback = {
  detail: string;
  title: string;
  warning: boolean;
};

type SessionsReaderProps = {
  pages: TranscriptPage[];
  primaryAction: SessionsPrimaryAction | null;
  savedActionFeedback: SessionsSavedActionFeedback | null;
  savedActions: SessionsSavedActions | null;
  recoveryReview: {
    command: string;
    cwd: string;
    reason: string;
  } | null;
  readerRef: RefObject<HTMLDivElement | null>;
  selected: SessionSummary | null;
  emptyState: SessionsReaderEmptyState | null;
  status: SessionsReaderStatus;
  pageError: string | null;
  readerMode: "conversation" | "raw";
  canReadRaw: boolean;
  onLoadMore: () => void;
  onRetryTranscript: () => void;
  onPrimaryAction: () => void;
  onReaderModeChange: (mode: "conversation" | "raw") => void;
  onScrollTopChange: (scrollTop: number) => void;
  onFocus: () => void;
};

export function SessionsReader({
  pages,
  primaryAction,
  savedActionFeedback,
  savedActions,
  recoveryReview,
  readerRef,
  selected,
  emptyState,
  status,
  pageError,
  readerMode,
  canReadRaw,
  onLoadMore,
  onRetryTranscript,
  onPrimaryAction,
  onReaderModeChange,
  onScrollTopChange,
  onFocus,
}: SessionsReaderProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailsCloseRef = useRef<HTMLButtonElement | null>(null);
  const blocks = pages.flatMap((page) => page.blocks);
  const nextCursor = pages.at(-1)?.nextCursor ?? null;
  const partial = pages.some((page) => page.partial);

  const closeDetails = (focus: "trigger" | "reader" = "trigger") => {
    setDetailsOpen(false);
    requestAnimationFrame(() => {
      if (focus === "reader") readerRef.current?.focus();
      else detailsTriggerRef.current?.focus();
    });
  };

  useEffect(() => {
    setDetailsOpen(false);
  }, [selected?.sessionKey]);

  useEffect(() => {
    if (detailsOpen) detailsCloseRef.current?.focus();
  }, [detailsOpen]);

  return (
    <main
      className={`sessions-reader${detailsOpen ? " sessions-reader--details-open" : ""}`}
      aria-label="Session reader"
      onFocusCapture={onFocus}
      onKeyDownCapture={(event) => {
        if (!detailsOpen || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        closeDetails();
      }}
    >
      <header className="sessions-reader__toolbar">
        {selected ? (
          <nav aria-label="Session breadcrumb" className="sessions-reader__breadcrumb">
            <span>{selected.project.label}</span>
            <span aria-hidden="true">/</span>
            <strong>{selected.title}</strong>
          </nav>
        ) : <strong>{emptyState ? "Get started" : "Select a conversation"}</strong>}
        <span className="sessions-reader__toolbar-spacer" />
        {selected && (
          <button
            ref={detailsTriggerRef}
            type="button"
            aria-controls="sessions-run-details"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen(true)}
          >
            Run details
          </button>
        )}
        {selected && primaryAction && (
          <button type="button" onClick={onPrimaryAction}>
            {primaryAction.label}
          </button>
        )}
        {selected && savedActions && (
          <div
            className="sessions-reader__saved-actions"
            role="toolbar"
            aria-label={savedActions.checkout ? "Saved checkout actions" : "Saved session actions"}
          >
            {savedActions.checkout && (
              <>
                <button
                  type="button"
                  disabled={savedActions.pendingAction !== undefined}
                  onClick={savedActions.onReview}
                >
                  {savedActions.pendingAction === "review" ? "Reviewing…" : "Review diff"}
                </button>
                <button
                  type="button"
                  disabled={savedActions.pendingAction !== undefined}
                  onClick={savedActions.onApply}
                >
                  {savedActions.pendingAction === "apply" ? "Applying…" : "Apply to project"}
                </button>
              </>
            )}
            <button
              type="button"
              className="sessions-reader__discard"
              aria-label="Discard saved session"
              disabled={savedActions.pendingAction !== undefined}
              onClick={savedActions.onDiscard}
            >
              Discard
            </button>
          </div>
        )}
      </header>
      <div className="sessions-reader__body">
        <div
          ref={readerRef}
          className="sessions-reader__scroll"
          tabIndex={-1}
          onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
        >
          {!selected && emptyState ? (
            <div className="sessions-reader__start" role="status">
              <strong>{emptyState.title}</strong>
              <p>{emptyState.detail}</p>
              <div className="sessions-reader__start-actions">
                <button type="button" onClick={emptyState.primaryAction.onClick}>
                  {emptyState.primaryAction.label}
                </button>
                {emptyState.secondaryAction && (
                  <button type="button" onClick={emptyState.secondaryAction.onClick}>
                    {emptyState.secondaryAction.label}
                  </button>
                )}
              </div>
            </div>
          ) : !selected ? (
            <div className="sessions-reader__empty">
              <strong>Choose a conversation from the list.</strong>
            </div>
          ) : (
            <article aria-label={selected.title} className="sessions-transcript">
              <header>
                <h1>{selected.title}</h1>
                <p>
                  {selected.project.label} · {
                    selected.source === "managed" ? "Managed session" : "External Codex"
                  }
                </p>
              </header>
              {savedActionFeedback && (
                <section
                  className={`sessions-saved-action-feedback${savedActionFeedback.warning ? " warning" : ""}`}
                  role={savedActionFeedback.warning ? "alert" : "status"}
                  aria-label={savedActionFeedback.warning
                    ? "Saved session action failed"
                    : "Saved session action result"}
                >
                  <strong>{savedActionFeedback.title}</strong>
                  <span>{savedActionFeedback.detail}</span>
                </section>
              )}
              {recoveryReview && (
                <section className="sessions-recovery-review" aria-label="Relaunch review">
                  <strong>Confirm relaunch</strong>
                  <span>{recoveryReview.reason}</span>
                  <code>{recoveryReview.command}</code>
                  <span>{recoveryReview.cwd}</span>
                </section>
              )}
              {status === "loading" ? (
                <div className="sessions-reader__empty"><strong>Loading transcript…</strong></div>
              ) : status === "missing" || status === "error" ? (
                <div className="sessions-reader__empty">
                  <strong>Transcript is unavailable.</strong>
                  {status === "error" && (
                    <button type="button" onClick={onRetryTranscript}>Refresh transcript</button>
                  )}
                </div>
              ) : (
                <>
                  {partial && <p className="sessions-transcript__partial">Transcript is incomplete.</p>}
                  <TranscriptBlocks blocks={blocks} />
                  {pageError && (
                    <p className="sessions-transcript__partial">
                      {pageError}{" "}
                      <button type="button" onClick={onRetryTranscript}>Refresh transcript</button>
                    </p>
                  )}
                  {nextCursor && (
                    <button type="button" onClick={onLoadMore}>Load more transcript</button>
                  )}
                </>
              )}
            </article>
          )}
        </div>
        {detailsOpen && selected && (
          <aside
            id="sessions-run-details"
            className="sessions-run-details"
            aria-labelledby="sessions-run-details-title"
          >
            <header>
              <h2 id="sessions-run-details-title">Run details</h2>
              <button
                ref={detailsCloseRef}
                type="button"
                aria-label="Close Run details"
                onClick={() => closeDetails()}
              >
                ×
              </button>
            </header>
            <dl>
              <RunDetail label="Project" value={selected.project.label} />
              <RunDetail label="Source" value={selected.source === "managed" ? "Managed session" : "External Codex"} />
              <RunDetail label="Location" value={selected.locationLabel} technical />
              {selected.branch && <RunDetail label="Branch" value={selected.branch} technical />}
              {selected.model && <RunDetail label="Model" value={selected.model} technical />}
              {(selected.delegatedRunCount ?? 0) > 0 && (
                <RunDetail
                  label="Delegated work"
                  value={`${selected.delegatedRunCount} internal run${selected.delegatedRunCount === 1 ? "" : "s"}`}
                />
              )}
            </dl>
            <footer>
              {canReadRaw && (
                <button
                  type="button"
                  className="sessions-reader__mode"
                  onClick={() => {
                    onReaderModeChange(readerMode === "raw" ? "conversation" : "raw");
                    closeDetails("reader");
                  }}
                >
                  {readerMode === "raw" ? "Clean conversation" : "Raw transcript"}
                </button>
              )}
              <button type="button" onClick={() => closeDetails()}>Done</button>
            </footer>
          </aside>
        )}
      </div>
    </main>
  );
}

function RunDetail({
  label,
  value,
  technical = false,
}: {
  label: string;
  value: string;
  technical?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={technical ? "technical" : undefined}>{value}</dd>
    </div>
  );
}

function TranscriptBlocks({ blocks }: { blocks: TranscriptBlock[] }) {
  const terminalBlocks = blocks.filter((block) => block.kind === "terminal");
  let renderedTerminal = false;

  return (
    <div className="sessions-transcript__blocks">
      {blocks.map((block) => {
        if (block.kind === "terminal") {
          if (renderedTerminal) return null;
          renderedTerminal = true;
          return (
            <pre role="document" aria-label="Terminal transcript" key="terminal-transcript">
              {terminalBlocks.map((terminalBlock) => (
                <span data-testid="transcript-block" key={terminalBlock.id}>{terminalBlock.text}{"\n"}</span>
              ))}
            </pre>
          );
        }
        if (block.kind === "message") {
          return (
            <section className={`sessions-message ${block.role}`} data-testid="transcript-block" key={block.id}>
              <strong className="sessions-message__role">{roleLabel(block.role)}</strong>
              <div className="sessions-message__body">{block.text}</div>
            </section>
          );
        }
        return (
          <section className="sessions-transcript__notice" data-testid="transcript-block" key={block.id}>
            {block.text}
          </section>
        );
      })}
    </div>
  );
}

function roleLabel(role: Extract<TranscriptBlock, { kind: "message" }>["role"]): string {
  if (role === "user") return "You";
  if (role === "assistant") return "Assistant";
  return "System";
}
