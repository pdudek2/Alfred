import { useEffect, useRef, useState } from "react";
import type { TerminalWorktreeDiffResult } from "../../shared/terminal-ipc";
import { getDesktopTerminalApi } from "../desktop-api";
import { isReviewableWorktreeSession } from "../session-scope";
import { sessionInstanceKey, type SessionTile } from "../session-state";
import { parseUnifiedDiff } from "../worktree-diff";

// Each read runs git status and git diff on the checkout, and an agent at work records activity many times a second.
const CHANGES_REREAD_QUIET_MS = 1_500;

export function DetailsChanges({ open, session, projectName, pendingAction, onReview, onApply }: {
  open: boolean;
  session: SessionTile | null;
  projectName: string;
  pendingAction?: "review" | "apply" | undefined;
  onReview: (id: string) => void;
  onApply: (id: string) => void;
}) {
  const pending = pendingAction !== undefined;
  const reviewable = Boolean(session && session.stage !== "staged" && isReviewableWorktreeSession(session));
  const instanceKey = session ? sessionInstanceKey(session) : "";
  const sessionId = session?.id;
  const [snapshot, setSnapshot] = useState<{ key: string; result: TerminalWorktreeDiffResult } | null>(null);
  const [reread, setReread] = useState(0);
  const lastActivityAt = session?.lastActivityAt;
  const seenActivityAtRef = useRef(lastActivityAt);
  // The changes are read on opening, and again once the session's activity has been quiet for a moment.
  useEffect(() => {
    if (lastActivityAt === seenActivityAtRef.current) return;
    seenActivityAtRef.current = lastActivityAt;
    if (!open || !reviewable) return;
    const timer = setTimeout(() => setReread((count) => count + 1), CHANGES_REREAD_QUIET_MS);
    return () => clearTimeout(timer);
  }, [open, reviewable, lastActivityAt]);
  useEffect(() => {
    if (!open || !reviewable || !sessionId || pending) return;
    let cancelled = false;
    const inspect = async () => {
      let result: TerminalWorktreeDiffResult;
      try {
        result = await getDesktopTerminalApi()?.worktreeDiff({ clientId: sessionId })
          ?? { ok: false, error: "Worktree changes are unavailable." };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : "Worktree changes are unavailable." };
      }
      if (!cancelled) setSnapshot({ key: instanceKey, result });
    };
    void inspect();
    return () => { cancelled = true; };
  }, [open, reviewable, sessionId, instanceKey, pending, reread]);
  const result = snapshot?.key === instanceKey ? snapshot.result : null;
  const diff = result?.ok ? parseUnifiedDiff(result.patch) : null;
  // A session working in the project itself has no changes of its own to show.
  if (!reviewable) return null;
  return (
    <section className="details-section" aria-label="Changes">
      <header className="details-section-heading">
        <h2>Changes</h2>
        {result?.ok && result.files.length > 0 && <span>{result.files.length} {result.files.length === 1 ? "file" : "files"}</span>}
        {diff && result?.ok && result.files.length > 0 && <span className="details-stats"><span className="details-additions">+{diff.additions}</span> <span className="details-deletions">−{diff.deletions}</span></span>}
      </header>
      {result?.ok && result.files.length === 0 ? <p className="details-empty">No worktree changes.</p>
        : !result ? <p className="details-empty" role="status">Loading changes…</p>
        : !result.ok ? <p className="details-empty" role="alert">{result.error}</p>
        : <>
          <ul className="details-files" aria-label="Changed files">
            {result.files.map((file) => {
              const change = file.status === "??" ? "A" : file.status.trim().charAt(0).toUpperCase();
              return <li key={file.path}>
                <FileTypeMark path={file.path} />
                <span className="details-file-name" title={file.path}>{file.path}</span>
                <span className={`details-file-change change-${change.toLowerCase()}`} aria-label={`Status ${change}`}>{change}</span>
              </li>;
            })}
          </ul>
          <div className="details-actions">
            <button type="button" disabled={pending} onClick={() => sessionId && onReview(sessionId)}>
              {pendingAction === "review" ? "Reviewing..." : "Review diff"}
            </button>
            {result.applied
              ? <span className="details-applied" role="status">Applied to {projectName}</span>
              : <button type="button" disabled={pending} onClick={() => sessionId && onApply(sessionId)}>
                {pendingAction === "apply" ? "Applying..." : `Apply to ${projectName}`}
              </button>}
          </div>
        </>}
    </section>
  );
}

const FILE_TYPE_LABELS: Readonly<Record<string, readonly [label: string, className: string]>> = {
  ts: ["TS", "type-ts"],
  tsx: ["TS", "type-ts"],
  css: ["#", "type-css"],
  json: ["{}", "type-json"],
  md: ["MD", "type-md"],
};
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function FileTypeMark({ path }: { path: string }) {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const label = FILE_TYPE_LABELS[extension];
  if (label) return <span className={`details-file-type ${label[1]}`} aria-hidden="true">{label[0]}</span>;
  if (IMAGE_EXTENSIONS.has(extension)) {
    return (
      <span className="details-file-type type-image" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <circle cx="6" cy="6.5" r="1.2" />
          <path d="M3 12l3.5-3.5 2.5 2.5 2-2 2 2" />
        </svg>
      </span>
    );
  }
  if (extension === "pdf") {
    return (
      <span className="details-file-type type-pdf" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M4 1.8h5.5L13 5.3v8.4c0 .3-.3.5-.5.5h-8c-.3 0-.5-.2-.5-.5V2.3c0-.3.2-.5.5-.5z" />
          <path d="M5.8 10.5h4.4" />
        </svg>
      </span>
    );
  }
  return <span className="details-file-type" aria-hidden="true" />;
}
