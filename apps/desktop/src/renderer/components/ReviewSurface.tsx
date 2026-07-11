import { AlertTriangle, ArrowRight, CheckCircle2, Play, RotateCcw, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { isLaunchBlocked } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { formatCommand } from "../command-display";
import { sessionRelaunchSafety } from "../relaunch-safety";
import { restoredSessionActionLabel } from "../restored-session-action";
import type { WorkspaceReviewItem } from "../workspace-attention";

type ReviewSurfaceProps = {
  armedRecoverySessionIds: Set<string>;
  items: WorkspaceReviewItem[];
  selectedSessionId: string | null;
  onContinueRestoredSession: (tileId: string) => void;
  onDiscardSession: (tileId: string) => void;
  onFocusItem: (workspaceId: string, sessionId: string) => void;
  onLaunchItem: (workspaceId: string, sessionId: string) => void;
  onRestartSession: (tileId: string) => void;
  onReviewBlockedItem: (workspaceId: string, sessionId: string) => void;
};

export function ReviewSurface({
  armedRecoverySessionIds,
  items,
  selectedSessionId,
  onContinueRestoredSession,
  onDiscardSession,
  onFocusItem,
  onLaunchItem,
  onRestartSession,
  onReviewBlockedItem,
}: ReviewSurfaceProps) {
  const surfaceRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    surfaceRef.current?.focus();
  }, []);

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
    <section ref={surfaceRef} className="review-surface inbox-surface" aria-label="Inbox workspace" tabIndex={-1}>
      <header className="review-surface-header">
        <div>
          <strong>Decision inbox</strong>
          <p>Launch, restart, resume, or discard queued work.</p>
        </div>
        {items.length > 0 && <span className="review-surface-waiting">{items.length} waiting</span>}
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
          {sections
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <section
                className="inbox-section"
                aria-label={section.title}
                aria-describedby={`inbox-section-${section.id}-detail`}
                key={section.id}
              >
                <header title={section.detail}>
                  <strong>{section.title}</strong>
                  <small>{section.items.length}</small>
                  <p className="visually-hidden" id={`inbox-section-${section.id}-detail`}>
                    {section.detail}
                  </p>
                </header>
                <ol className="review-surface-list" aria-label={`${section.title} items`}>
                  {section.items.map((item) => (
                    <ReviewSurfaceItem
                      armed={
                        (item.status.kind === "restored" || item.status.kind === "done" || item.status.kind === "error") &&
                        armedRecoverySessionIds.has(item.session.id)
                      }
                      item={item}
                      key={item.id}
                      selected={item.session.id === selectedSessionId}
                      onContinueRestoredSession={onContinueRestoredSession}
                      onDiscardSession={onDiscardSession}
                      onFocusItem={onFocusItem}
                      onLaunchItem={onLaunchItem}
                      onRestartSession={onRestartSession}
                      onReviewBlockedItem={onReviewBlockedItem}
                    />
                  ))}
                </ol>
              </section>
            ))}
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

function ReviewSurfaceItem({
  armed,
  item,
  selected,
  onContinueRestoredSession,
  onDiscardSession,
  onFocusItem,
  onLaunchItem,
  onRestartSession,
  onReviewBlockedItem,
}: {
  armed: boolean;
  item: WorkspaceReviewItem;
  selected: boolean;
  onContinueRestoredSession: (tileId: string) => void;
  onDiscardSession: (tileId: string) => void;
  onFocusItem: (workspaceId: string, sessionId: string) => void;
  onLaunchItem: (workspaceId: string, sessionId: string) => void;
  onRestartSession: (tileId: string) => void;
  onReviewBlockedItem: (workspaceId: string, sessionId: string) => void;
}) {
  const status = terminalSessionDisplayStatus(item.session);
  const command = formatCommand(item.session);
  const hardBlocked = isLaunchBlocked(item.session);
  const checking = item.status.kind === "checking";
  const recoveryAction = item.status.kind === "restored" || item.status.kind === "done" || item.status.kind === "error";
  const stagedAction = item.status.kind === "staged" || item.status.kind === "blocked" || item.status.kind === "checking";
  const relaunchSafety = recoveryAction ? sessionRelaunchSafety(item.session) : { safe: true as const };
  const relaunchNeedsReview = recoveryAction && !relaunchSafety.safe;
  const ageSource = item.session.lastActivityAt ?? item.session.createdAt;
  const ageLabel = sessionAgeLabel(ageSource);
  const action = reviewSurfaceAction(item, relaunchNeedsReview, armed);

  const runAction = () => {
    if (checking) return;
    if (hardBlocked) {
      onReviewBlockedItem(item.workspaceId, item.session.id);
      return;
    }
    if (item.status.kind === "waiting") {
      onFocusItem(item.workspaceId, item.session.id);
      return;
    }
    if (item.status.kind === "staged") {
      onLaunchItem(item.workspaceId, item.session.id);
      return;
    }
    if (item.status.kind === "restored") {
      onContinueRestoredSession(item.session.id);
      if (relaunchNeedsReview && !armed) return;
      onFocusItem(item.workspaceId, item.session.id);
      return;
    }
    if (item.status.kind === "done" || item.status.kind === "error") {
      onRestartSession(item.session.id);
      if (relaunchNeedsReview && !armed) return;
      onFocusItem(item.workspaceId, item.session.id);
    }
  };

  return (
    <li className={`review-surface-item tone-${item.status.kind} ${selected ? "selected" : ""}`}>
      <div className="review-surface-row">
        <button
          type="button"
          className="review-surface-item-main"
          onClick={() => onFocusItem(item.workspaceId, item.session.id)}
          aria-label={`Open ${item.session.title} in ${item.workspaceLabel}`}
        >
          <span className="review-surface-workspace">{item.workspaceShortLabel}</span>
          <span className="review-surface-copy">
            <strong>{item.session.title}</strong>
            <small title={`${item.workspaceLabel} · ${status.label} · ${item.detail}`}>
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
        <div className="review-surface-actions">
          {action !== null && (
            <button
              type="button"
              className={`review-surface-primary action-${item.status.kind} ${armed ? "armed" : ""}`}
              disabled={checking}
              onClick={runAction}
              aria-label={`${action} ${item.session.title} in ${item.workspaceLabel}`}
            >
              {recoveryAction
                ? <RotateCcw size={14} />
                : item.status.kind === "waiting"
                  ? <ArrowRight size={14} />
                  : <Play size={14} />}
              <span>{action}</span>
            </button>
          )}
          {(stagedAction || recoveryAction) && (
            <button
              type="button"
              className="review-surface-discard"
              title="Discard"
              aria-label={`Discard ${item.session.title} from ${item.workspaceLabel}`}
              onClick={() => onDiscardSession(item.session.id)}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {(hardBlocked || checking || item.session.safetyNote || relaunchNeedsReview) && (
        <div className="review-surface-note" role="note">
          <AlertTriangle size={14} />
          <span>
            {checking
              ? "Alfred is rechecking this edited command."
              : item.session.launchPreflight?.status === "blocked"
                ? item.session.launchPreflight.reason
                : item.session.safetyNote ?? (!relaunchSafety.safe ? relaunchSafety.reason : "This launch needs review.")}
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
    </li>
  );
}

function reviewSurfaceAction(item: WorkspaceReviewItem, unsafe: boolean, armed: boolean): string | null {
  switch (item.status.kind) {
    case "waiting":
      return "Open";
    case "staged":
      return "Launch";
    case "blocked":
      return item.session.safetyNote ? "Review and edit" : "Review details";
    case "checking":
      return "Checking";
    case "restored":
      return restoredSessionActionLabel(item.session, unsafe, armed);
    case "done":
    case "error":
      return unsafe ? (armed ? "Confirm restart" : "Review restart") : "Restart";
    case "active":
    case "idle":
    case "runtime":
    case "starting":
      return null;
  }
}
