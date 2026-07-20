import type { RefObject } from "react";
import type { SessionSummary, TranscriptBlock, TranscriptPage } from "../../shared/sessions-ipc";
import type { SessionsPrimaryAction } from "../sessions-projection";

export type SessionsReaderStatus = "idle" | "loading" | "ready" | "missing" | "error";

type SessionsReaderProps = {
  pages: TranscriptPage[];
  primaryAction: SessionsPrimaryAction | null;
  recoveryReview: {
    command: string;
    cwd: string;
    reason: string;
  } | null;
  readerRef: RefObject<HTMLDivElement | null>;
  selected: SessionSummary | null;
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
  recoveryReview,
  readerRef,
  selected,
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
  const blocks = pages.flatMap((page) => page.blocks);
  const nextCursor = pages.at(-1)?.nextCursor ?? null;
  const partial = pages.some((page) => page.partial);

  return (
    <main className="sessions-reader" aria-label="Session reader" onFocusCapture={onFocus}>
      <header className="sessions-reader__toolbar">
        <strong>{selected?.title ?? "Select a session"}</strong>
        {selected && <span>{selected.project.label} · {selected.locationLabel}</span>}
        <span className="sessions-reader__toolbar-spacer" />
        {selected && canReadRaw && (
          <button type="button" className="sessions-reader__mode" onClick={() => onReaderModeChange(readerMode === "raw" ? "conversation" : "raw") }>
            {readerMode === "raw" ? "Clean conversation" : "Raw transcript"}
          </button>
        )}
        {selected && primaryAction && (
          <button type="button" onClick={onPrimaryAction}>
            {primaryAction.label}
          </button>
        )}
      </header>
      <div
        ref={readerRef}
        className="sessions-reader__scroll"
        tabIndex={-1}
        onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
      >
        {!selected ? (
          <div className="sessions-reader__empty">
            <strong>Select a session to read it.</strong>
            <span>Transcript content is loaded only when you open a result.</span>
          </div>
        ) : (
          <article aria-label={selected.title} className="sessions-transcript">
            <header>
              <h1>{selected.title}</h1>
              <p>{selected.project.label} · {selected.source === "managed" ? "Managed session" : "External Codex"}</p>
            </header>
            {(selected.delegatedRunCount ?? 0) > 0 && (
              <details className="sessions-delegated-work">
                <summary>Delegated work <span>{selected.delegatedRunCount}</span></summary>
                <p>Internal agent runs are attached to this conversation and hidden from the primary list.</p>
              </details>
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
                {status === "error" && <button type="button" onClick={onRetryTranscript}>Refresh transcript</button>}
              </div>
            ) : (
              <>
                {partial && <p className="sessions-transcript__partial">Transcript is incomplete.</p>}
                <TranscriptBlocks blocks={blocks} />
                {pageError && (
                  <p className="sessions-transcript__partial">
                    {pageError} <button type="button" onClick={onRetryTranscript}>Refresh transcript</button>
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
    </main>
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
