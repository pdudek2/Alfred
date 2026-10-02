import { useEffect, useState } from "react";
import type { TerminalWorktreeDiffResult } from "../../shared/terminal-ipc";
import { getDesktopTerminalApi } from "../desktop-api";
import { isReviewableWorktreeSession } from "../session-scope";
import { sessionInstanceKey, type SessionTile } from "../session-state";
import { parseUnifiedDiff } from "../worktree-diff";

export function DetailsChanges({ open, session, projectName, pending, onReview, onApply }: {
  open: boolean;
  session: SessionTile | null;
  projectName: string;
  pending: boolean;
  onReview: (id: string) => void;
  onApply: (id: string) => void;
}) {
  const reviewable = Boolean(session && session.stage !== "staged" && isReviewableWorktreeSession(session));
  const instanceKey = session ? sessionInstanceKey(session) : "";
  const sessionId = session?.id;
  const [snapshot, setSnapshot] = useState<{ key: string; result: TerminalWorktreeDiffResult } | null>(null);
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
  }, [open, reviewable, sessionId, instanceKey, pending, session?.lastActivityAt]);
  const result = snapshot?.key === instanceKey ? snapshot.result : null;
  const diff = result?.ok ? parseUnifiedDiff(result.patch) : null;
  return (
    <section className="details-section" aria-label="Changes">
      <header className="details-section-heading">
        <h2>Changes</h2>
        {result?.ok && result.files.length > 0 && <span>{result.files.length} {result.files.length === 1 ? "file" : "files"}</span>}
        {diff && result?.ok && result.files.length > 0 && <span className="details-stats">+{diff.additions} −{diff.deletions}</span>}
      </header>
      {!reviewable || (result?.ok && result.files.length === 0) ? <p className="details-empty">No worktree changes.</p>
        : !result ? <p className="details-empty" role="status">Loading changes…</p>
        : !result.ok ? <p className="details-empty" role="alert">{result.error}</p>
        : <>
          <ul className="details-files" aria-label="Changed files">
            {result.files.map((file) => {
              const stats = diff?.files[file.path];
              return <li key={file.path}>
                <span title={file.path}>{file.path}</span>
                {stats ? <><span className="details-additions">+{stats.additions}</span><span className="details-deletions">−{stats.deletions}</span></>
                  : <span aria-label={`Status ${file.status}`}>{file.status}</span>}
              </li>;
            })}
          </ul>
          <div className="details-actions">
            <button type="button" disabled={pending} onClick={() => sessionId && onReview(sessionId)}>Review diff</button>
            <button type="button" disabled={pending} onClick={() => sessionId && onApply(sessionId)}>Apply to {projectName}</button>
          </div>
        </>}
    </section>
  );
}
