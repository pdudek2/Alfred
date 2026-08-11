import { useEffect, useMemo, useRef } from "react";
import { parseUnifiedDiff, type WorktreeDiffLine, type WorktreeDiffView } from "../worktree-diff";
import "./worktree-diff-panel.css";

export type WorktreeDiffCloseReason = "button" | "escape";

export function WorktreeDiffPanel({
  view,
  onClose,
}: {
  view: WorktreeDiffView;
  onClose: (reason: WorktreeDiffCloseReason) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, [view.instanceKey]);

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
          <h2>Last review</h2>
          <p>{view.sessionTitle}</p>
        </div>
        <button ref={closeRef} type="button" onClick={() => onClose("button")}>
          {view.status === "error" ? "Back to terminal" : "Close diff"}
        </button>
      </header>
      {view.status === "loading" && (
        <p className="worktree-diff-panel__state" role="status">Loading checkout diff…</p>
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
              <span aria-label={`Status ${file.status}`}>{file.status}</span>
              <code>{file.path}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="worktree-diff-panel__empty">No changed files in this checkout.</p>
      )}
      {parsed.lines.length > 0 ? (
        <div className="worktree-diff-panel__code" role="table" aria-label="Unified diff">
          {parsed.lines.map((line, index) => (
            <div
              className={`worktree-diff-panel__line is-${line.kind} kind-${line.kind}`}
              role="row"
              aria-label={diffLineLabel(line)}
              key={`${index}:${line.text}`}
            >
              <span aria-hidden="true">{line.oldLine ?? ""}</span>
              <span aria-hidden="true">{line.newLine ?? ""}</span>
              <code>{line.text || " "}</code>
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
  if (line.kind === "hunk") return "Diff hunk";
  return "Diff metadata";
}
