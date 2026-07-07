import { AlertTriangle, ArrowRight, CheckCircle2, Play, RotateCcw, ShieldAlert, X } from "lucide-react";
import { isLaunchBlocked } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { formatCommand } from "../command-display";
import { sessionRelaunchSafety } from "../relaunch-safety";
import { restoredSessionActionLabel } from "../restored-session-action";
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
  const sections = [
    {
      id: "needs-decision",
      title: "Needs decision",
      detail: "Launch approvals and edited staged commands.",
      items: items.filter((item) => inboxSectionForItem(item) === "needs-decision"),
    },
    {
      id: "blocked-safety",
      title: "Blocked & safety",
      detail: "Preflight failures, unsafe relaunches and discard gates.",
      items: items.filter((item) => inboxSectionForItem(item) === "blocked-safety"),
    },
    {
      id: "recovery",
      title: "Recovery",
      detail: "Restored, exited and failed sessions that need a restart or discard.",
      items: items.filter((item) => inboxSectionForItem(item) === "recovery"),
    },
  ];

  return (
    <section className="review-surface inbox-surface" aria-label="Inbox workspace">
      <header className="review-surface-header">
        <div>
          <strong>Decision inbox</strong>
          <p>Launch, restart, resume, or discard queued work.</p>
        </div>
        {stagedCount + blockedCount + recoveryCount > 0 && (
          <div className="review-surface-stats" aria-label="Inbox summary">
            {stagedCount > 0 && <ReviewStat label="staged" value={stagedCount} />}
            {blockedCount > 0 && <ReviewStat label="blocked" value={blockedCount} />}
            {recoveryCount > 0 && <ReviewStat label="recovery" value={recoveryCount} />}
          </div>
        )}
      </header>

      {items.length === 0 ? (
        <div className="review-surface-empty" role="status">
          <div className="review-empty-lead">
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>Queue clear</span>
            <strong>No decisions waiting.</strong>
            <p>New launch gates and recovery prompts will land here while Work stays focused on active terminals.</p>
          </div>
        </div>
      ) : (
        <div className="inbox-section-stack" aria-label="Inbox sections">
          {sections.map((section) => {
            const populated = section.items.length > 0;

            return (
              <section
                className={`inbox-section ${populated ? "is-populated" : "is-empty"}`}
                data-state={populated ? "populated" : "empty"}
                aria-label={section.title}
                key={section.id}
              >
                <header>
                  <div>
                    <strong>{section.title}</strong>
                    <span>{section.detail}</span>
                  </div>
                  <small>{section.items.length}</small>
                </header>
                {populated && (
                  <ol className="review-surface-list" aria-label={`${section.title} items`}>
                    {section.items.map((item) => (
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
          })}
        </div>
      )}
    </section>
  );
}

function inboxSectionForItem(item: WorkspaceReviewItem): "needs-decision" | "blocked-safety" | "recovery" {
  if (item.status.kind === "restored" || item.status.kind === "done" || item.status.kind === "error") {
    return "recovery";
  }
  if (item.status.kind === "blocked" || item.session.safetyNote || isLaunchBlocked(item.session)) {
    return "blocked-safety";
  }
  return "needs-decision";
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
  const relaunchSafety = recoveryAction ? sessionRelaunchSafety(item.session) : { safe: true };
  const relaunchNeedsReview = recoveryAction && !relaunchSafety.safe;
  const ageSource = item.session.lastActivityAt ?? item.session.createdAt;
  const ageLabel = sessionAgeLabel(ageSource);
  const action = reviewSurfaceAction(item, relaunchNeedsReview, armed);

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

      {stagedAction && (
        <div className="review-surface-command">
          <span>Launch command</span>
          <code>{command}</code>
        </div>
      )}

      {recoveryAction && (
        <details className="review-surface-command is-disclosure">
          <summary>
            <span>Restart command</span>
          </summary>
          <code>{command}</code>
        </details>
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

function reviewSurfaceAction(item: WorkspaceReviewItem, unsafe: boolean, armed: boolean): string {
  switch (item.status.kind) {
    case "restored":
      return restoredSessionActionLabel(item.session, unsafe, armed);
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
