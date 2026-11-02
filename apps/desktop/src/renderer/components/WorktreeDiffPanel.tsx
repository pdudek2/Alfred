import { useEffect, useMemo, useRef } from "react";
import { parseUnifiedDiff, type WorktreeDiffLine, type WorktreeDiffView } from "../worktree-diff";
import { FileChangeLetter } from "./DetailsChanges";
import "./worktree-diff-panel.css";

export type WorktreeDiffCloseReason = "button" | "escape";

export function WorktreeDiffPanel({
  view,
  projectName,
  pendingAction,
  onApply,
  onReview,
  onDiscard,
  onClose,
}: {
  view: WorktreeDiffView;
  projectName: string;
  pendingAction?: "review" | "apply" | undefined;
  onApply: (sessionId: string, reviewedFingerprint: string) => void;
  onReview: (sessionId: string) => void;
  onDiscard: (sessionId: string) => void;
  onClose: (reason: WorktreeDiffCloseReason) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const reviewRef = useRef<HTMLButtonElement | null>(null);
  const hasChanges = view.status === "ready" && view.result.files.length > 0;
  const applied = hasChanges && view.result.applied;
  const refusal = view.status === "ready" ? view.applyRefusal : undefined;
  const pending = pendingAction !== undefined;

  useEffect(() => {
    (refusal ? reviewRef : closeRef).current?.focus();
  }, [view.instanceKey, applied, refusal]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose("escape");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <section className="worktree-diff-panel" role="region" aria-label="Worktree diff">
      <header className="worktree-diff-panel__header">
        <div>
          <h2>{view.sessionTitle}</h2>
          {refusal
            ? <p className="worktree-diff-panel__refusal" role="alert">{refusal}</p>
            : <p>Changes in its isolated worktree</p>}
        </div>
        <div className="worktree-diff-panel__actions">
          {applied && <span className="worktree-diff-panel__applied" role="status">Applied to {projectName}</span>}
          {hasChanges && !applied && <>
            <button type="button" className="worktree-diff-panel__discard" disabled={pending} onClick={() => onDiscard(view.sessionId)}>
              Discard
            </button>
            {refusal
              ? <button ref={reviewRef} type="button" disabled={pending} onClick={() => onReview(view.sessionId)}>Review diff</button>
              : <button type="button" disabled={pending} onClick={() => onApply(view.sessionId, view.result.fingerprint)}>
                {pendingAction === "apply" ? "Applying..." : `Apply to ${projectName}`}
              </button>}
          </>}
          <button ref={closeRef} type="button" onClick={() => onClose("button")}>
            {view.status === "error" ? "Back to terminal" : "Close diff"}
          </button>
        </div>
      </header>
      {view.status === "loading" && (
        <p className="worktree-diff-panel__state" role="status">Loading worktree diff…</p>
      )}
      {view.status === "error" && (
        <p className="worktree-diff-panel__state is-error" role="alert">{view.error}</p>
      )}
      {view.status === "ready" && <ReadyDiff view={view} />}
    </section>
  );
}

function ReadyDiff({ view }: { view: Extract<WorktreeDiffView, { status: "ready" }> }) {
  const parsed = useMemo(() => parseUnifiedDiff(view.result.patch), [view.result.patch]);
  // Git's own header lines repeat the file row above them.
  const lines = parsed.lines.filter((line) => line.kind !== "meta");
  const hasUntrackedFiles = view.result.files.some((file) => file.status === "??");

  return (
    <div className="worktree-diff-panel__body">
      <div className="worktree-diff-panel__summary">
        <strong>{view.result.summary}</strong>
        <span className="worktree-diff-panel__additions">+{parsed.additions}</span>
        <span className="worktree-diff-panel__deletions">−{parsed.deletions}</span>
      </div>
      {view.result.files.length > 0 ? (
        <ul className="worktree-diff-panel__files" aria-label="Changed files">
          {view.result.files.map((file) => (
            <li key={`${file.status}:${file.path}`}>
              <FileChangeLetter status={file.status} />
              <code>{file.path}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="worktree-diff-panel__empty">No changed files in this worktree.</p>
      )}
      {lines.length > 0 ? (
        <div className="worktree-diff-panel__code" role="list" aria-label="Unified diff">
          {/* A list, not a table without cells; each line says what changed and then reads its code. */}
          {lines.map((line, index) => (
            <div
              className={`worktree-diff-panel__line is-${line.kind} kind-${line.kind}`}
              role="listitem"
              key={`${index}:${line.text}`}
            >
              <span aria-hidden="true">{line.oldLine ?? ""}</span>
              <span aria-hidden="true">{line.newLine ?? ""}</span>
              <code><span className="visually-hidden">{diffLineLabel(line)}: </span>{line.text || " "}</code>
            </div>
          ))}
        </div>
      ) : (
        <p className="worktree-diff-panel__empty">
          {hasUntrackedFiles
            ? "Untracked files are listed above. Git cannot show their contents until they are added."
            : "No patch content is available."}
        </p>
      )}
    </div>
  );
}

function diffLineLabel(line: WorktreeDiffLine): string {
  if (line.kind === "add") return `Added line ${line.newLine}`;
  if (line.kind === "remove") return `Removed line ${line.oldLine}`;
  if (line.kind === "context") return `Unchanged line ${line.newLine}`;
  return "Diff hunk";
}
