import { AlertTriangle, ArrowRight, Play, RotateCcw, X } from "lucide-react";
import { isLaunchBlocked } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { formatCommand } from "../command-display";
import type { WorkspaceReviewItem } from "../workspace-attention";

type ReviewSurfaceProps = {
  armedUnsafeSessionIds: Set<string>;
  items: WorkspaceReviewItem[];
  selectedSessionId: string | null;
  onApproveTile: (tileId: string) => void;
  onContinueRestoredSession: (tileId: string) => void;
  onDiscardSession: (tileId: string) => void;
  onFocusItem: (workspaceId: string, sessionId: string) => void;
  onLaunchItem: (workspaceId: string, sessionId: string) => void;
  onRestartSession: (tileId: string) => void;
};

export function ReviewSurface({
  armedUnsafeSessionIds,
  items,
  selectedSessionId,
  onApproveTile,
  onContinueRestoredSession,
  onDiscardSession,
  onFocusItem,
  onLaunchItem,
  onRestartSession,
}: ReviewSurfaceProps) {
  const stagedCount = items.filter((item) => item.status.kind === "staged" || item.status.kind === "checking").length;
  const blockedCount = items.filter((item) => item.status.kind === "blocked").length;
  const recoveryCount = items.filter((item) =>
    item.status.kind === "restored" || item.status.kind === "done" || item.status.kind === "error",
  ).length;

  return (
    <section className="review-surface" aria-label="Review workspace">
      <header className="review-surface-header">
        <div>
          <span>Review</span>
          <strong>Decisions queue</strong>
          <p>Launch, restart, resume, or discard queued work without turning the live desk into a warning wall.</p>
        </div>
        <div className="review-surface-stats" aria-label="Review queue summary">
          <ReviewStat label="staged" value={stagedCount} />
          <ReviewStat label="blocked" value={blockedCount} />
          <ReviewStat label="recovery" value={recoveryCount} />
        </div>
      </header>

      {items.length === 0 ? (
        <div className="review-surface-empty" role="status">
          <span>Clear queue</span>
          <strong>No decisions waiting.</strong>
          <p>Desk can stay focused on active terminal work.</p>
        </div>
      ) : (
        <ol className="review-surface-list" aria-label="Review items">
          {items.map((item) => (
            <ReviewSurfaceItem
              armed={armedUnsafeSessionIds.has(item.session.id)}
              item={item}
              key={item.id}
              selected={item.session.id === selectedSessionId}
              onApproveTile={onApproveTile}
              onContinueRestoredSession={onContinueRestoredSession}
              onDiscardSession={onDiscardSession}
              onFocusItem={onFocusItem}
              onLaunchItem={onLaunchItem}
              onRestartSession={onRestartSession}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function ReviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ReviewSurfaceItem({
  armed,
  item,
  selected,
  onApproveTile,
  onContinueRestoredSession,
  onDiscardSession,
  onFocusItem,
  onLaunchItem,
  onRestartSession,
}: {
  armed: boolean;
  item: WorkspaceReviewItem;
  selected: boolean;
  onApproveTile: (tileId: string) => void;
  onContinueRestoredSession: (tileId: string) => void;
  onDiscardSession: (tileId: string) => void;
  onFocusItem: (workspaceId: string, sessionId: string) => void;
  onLaunchItem: (workspaceId: string, sessionId: string) => void;
  onRestartSession: (tileId: string) => void;
}) {
  const status = terminalSessionDisplayStatus(item.session);
  const command = formatCommand(item.session);
  const hardBlocked = isLaunchBlocked(item.session);
  const checking = item.status.kind === "checking";
  const recoveryAction = item.status.kind === "restored" || item.status.kind === "done" || item.status.kind === "error";
  const stagedAction = item.status.kind === "staged" || item.status.kind === "blocked" || item.status.kind === "checking";
  const ageSource = item.session.lastActivityAt ?? item.session.createdAt;
  const ageLabel = sessionAgeLabel(ageSource);
  const action = reviewSurfaceAction(item.status.kind, armed);

  const runAction = () => {
    if (hardBlocked || checking) return;
    if (item.status.kind === "blocked" && !armed) {
      onApproveTile(item.session.id);
      return;
    }
    if (item.status.kind === "staged" || item.status.kind === "blocked") {
      onLaunchItem(item.workspaceId, item.session.id);
      return;
    }
    if (item.status.kind === "restored") {
      onContinueRestoredSession(item.session.id);
      onFocusItem(item.workspaceId, item.session.id);
      return;
    }
    if (item.status.kind === "done" || item.status.kind === "error") {
      onRestartSession(item.session.id);
      onFocusItem(item.workspaceId, item.session.id);
    }
  };

  return (
    <li className={`review-surface-item tone-${item.status.kind} ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className="review-surface-item-main"
        onClick={() => onFocusItem(item.workspaceId, item.session.id)}
        aria-label={`Open ${item.session.title} in ${item.workspaceLabel}`}
      >
        <span className="review-surface-workspace">{item.workspaceShortLabel}</span>
        <span className="review-surface-copy">
          <strong>{item.session.title}</strong>
          <small>
            {item.workspaceLabel} · {status.label} · {item.detail}
          </small>
        </span>
        {ageLabel && (
          <time dateTime={new Date(ageSource ?? Date.now()).toISOString()} title={sessionAgeTitle(ageSource)}>
            {ageLabel}
          </time>
        )}
        <ArrowRight size={15} />
      </button>

      {(hardBlocked || checking || item.session.safetyNote) && (
        <div className="review-surface-note" role="note">
          <AlertTriangle size={14} />
          <span>
            {checking
              ? "Alfred is rechecking this edited command."
              : item.session.launchPreflight?.status === "blocked"
                ? item.session.launchPreflight.reason
                : item.session.safetyNote ?? "This launch needs review."}
          </span>
        </div>
      )}

      {(stagedAction || recoveryAction) && (
        <div className="review-surface-command">
          <span>{recoveryAction ? "restart command" : "launch command"}</span>
          <code>{command}</code>
        </div>
      )}

      <div className="review-surface-actions">
        <button
          type="button"
          className={`review-surface-primary action-${item.status.kind} ${armed ? "armed" : ""}`}
          disabled={hardBlocked || checking}
          onClick={runAction}
        >
          {recoveryAction ? <RotateCcw size={14} /> : <Play size={14} />}
          <span>{action}</span>
        </button>
        {(stagedAction || recoveryAction) && (
          <button
            type="button"
            className="review-surface-discard"
            onClick={() => onDiscardSession(item.session.id)}
          >
            <X size={14} />
            <span>Discard</span>
          </button>
        )}
      </div>
    </li>
  );
}

function reviewSurfaceAction(kind: WorkspaceReviewItem["status"]["kind"], armed: boolean): string {
  switch (kind) {
    case "restored":
      return armed ? "Confirm resume" : "Resume";
    case "done":
      return armed ? "Confirm restart" : "Restart";
    case "error":
      return armed ? "Confirm restart" : "Restart";
    case "blocked":
      return armed ? "Launch" : "Review";
    case "checking":
      return "Checking";
    default:
      return "Launch";
  }
}
