import { AlertTriangle, ArrowRight, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import { isLaunchBlocked } from "../session-state";
import type { WorkspaceReviewItem } from "../workspace-attention";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { formatCommand } from "../command-display";
import { sessionRelaunchSafety } from "../relaunch-safety";

type ReviewQueuePanelProps = {
  armedUnsafeSessionIds: Set<string>;
  items: WorkspaceReviewItem[];
  selectedSessionId: string | null;
  onApproveTile: (tileId: string) => void;
  onClose: () => void;
  onContinueRestoredSession: (tileId: string) => void;
  onDiscardSession: (tileId: string) => void;
  onFocusItem: (workspaceId: string, sessionId: string) => void;
  onLaunchItem: (workspaceId: string, sessionId: string) => void;
  onRestartSession: (tileId: string) => void;
};

export function ReviewQueuePanel({
  armedUnsafeSessionIds,
  items,
  selectedSessionId,
  onApproveTile,
  onClose,
  onContinueRestoredSession,
  onDiscardSession,
  onFocusItem,
  onLaunchItem,
  onRestartSession,
}: ReviewQueuePanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const workspaceCount = useMemo(() => new Set(items.map((item) => item.workspaceId)).size, [items]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = focusableElements(panelRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="review-queue-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="global-review-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Review queue"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="global-review-header">
          <div>
            <span>Alfred queue</span>
            <strong>Review queue</strong>
            <small>
              {items.length} item{items.length === 1 ? "" : "s"} · {workspaceCount} workspace
              {workspaceCount === 1 ? "" : "s"}
            </small>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="global-review-close"
            onClick={onClose}
            aria-label="Close review queue"
          >
            <X size={15} />
          </button>
        </header>

        {items.length === 0 ? (
          <div className="global-review-empty" role="status">
            <span>Clear desk</span>
            <strong>No queued decisions.</strong>
          </div>
        ) : (
          <ol className="global-review-list">
            {items.map((item) => {
              const armed = armedUnsafeSessionIds.has(item.session.id);
              const selected = item.session.id === selectedSessionId;
              return (
                <ReviewQueuePanelItem
                  armed={armed}
                  item={item}
                  key={item.id}
                  selected={selected}
                  onApproveTile={onApproveTile}
                  onClose={onClose}
                  onContinueRestoredSession={onContinueRestoredSession}
                  onDiscardSession={onDiscardSession}
                  onFocusItem={onFocusItem}
                  onLaunchItem={onLaunchItem}
                  onRestartSession={onRestartSession}
                />
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function ReviewQueuePanelItem({
  armed,
  item,
  selected,
  onApproveTile,
  onClose,
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
  onClose: () => void;
  onContinueRestoredSession: (tileId: string) => void;
  onDiscardSession: (tileId: string) => void;
  onFocusItem: (workspaceId: string, sessionId: string) => void;
  onLaunchItem: (workspaceId: string, sessionId: string) => void;
  onRestartSession: (tileId: string) => void;
}) {
  const kind = sessionTileKind(item.session);
  const kindMeta = tileKindMeta(kind);
  const ageSource = item.session.lastActivityAt ?? item.session.createdAt;
  const ageLabel = sessionAgeLabel(ageSource);
  const action = reviewActionLabel(item, armed);
  const command = formatCommand(item.session);
  const recoveryAction = item.status.kind === "restored" || item.status.kind === "done" || item.status.kind === "error";
  const discardable = recoveryAction;
  const relaunchSafety = sessionRelaunchSafety(item.session);
  const relaunchNeedsReview = recoveryAction && !relaunchSafety.safe;
  const showCommand =
    item.status.kind === "blocked" ||
    item.status.kind === "checking" ||
    item.status.kind === "staged" ||
    (recoveryAction && Boolean(item.session.command));
  const hardBlocked = isLaunchBlocked(item.session);
  const checking = item.status.kind === "checking";

  const openItem = () => {
    onFocusItem(item.workspaceId, item.session.id);
    onClose();
  };

  const runAction = () => {
    if (hardBlocked || checking) return;
    if (item.status.kind === "blocked" && !armed) {
      onApproveTile(item.session.id);
      return;
    }

    if (item.status.kind === "staged" || item.status.kind === "blocked") {
      onLaunchItem(item.workspaceId, item.session.id);
      onClose();
      return;
    }

    if (item.status.kind === "restored") {
      onContinueRestoredSession(item.session.id);
      if (relaunchNeedsReview && !armed) return;
      onFocusItem(item.workspaceId, item.session.id);
      onClose();
      return;
    }

    if (item.status.kind === "error" || item.status.kind === "done") {
      onRestartSession(item.session.id);
      if (relaunchNeedsReview && !armed) return;
      onFocusItem(item.workspaceId, item.session.id);
      onClose();
    }
  };

  const discardItem = () => {
    onDiscardSession(item.session.id);
  };

  return (
    <li className={`global-review-item tone-${item.status.kind} ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className="global-review-item-main"
        onClick={openItem}
        aria-label={`Open ${item.session.title} in ${item.workspaceLabel}`}
      >
        <span className="global-review-workspace" aria-hidden="true">
          {item.workspaceShortLabel}
        </span>
        <span className={`review-kind ${kindMeta.className}`} title={kindMeta.label}>
          <TileKindIcon kind={kind} />
          <span>{kindMeta.shortLabel}</span>
        </span>
        <span className="global-review-copy">
          <strong>{item.session.title}</strong>
          <small>
            {item.workspaceLabel} · {item.status.label} · {item.detail}
          </small>
        </span>
        {ageLabel && (
          <time dateTime={new Date(ageSource ?? Date.now()).toISOString()} title={sessionAgeTitle(ageSource)}>
            {ageLabel}
          </time>
        )}
        <ArrowRight size={15} />
      </button>
      {checking && (
        <div className="global-review-warning checking" role="note">
          <AlertTriangle size={13} />
          <span>Rechecking edited command before launch.</span>
        </div>
      )}
      {hardBlocked && item.session.launchPreflight?.status === "blocked" && (
        <div className="global-review-warning blocked" role="note">
          <AlertTriangle size={13} />
          <span>{item.session.launchPreflight.reason}</span>
        </div>
      )}
      {!hardBlocked && item.session.safetyNote && (
        <div className="global-review-warning" role="note">
          <AlertTriangle size={13} />
          <span>{item.session.safetyNote}</span>
        </div>
      )}
      {relaunchNeedsReview && (
        <div className={`global-review-warning ${armed ? "" : "blocked"}`} role="note">
          <AlertTriangle size={13} />
          <span>{relaunchSafety.reason}</span>
        </div>
      )}
      {showCommand && (
        <div className="global-review-command">
          <span>{item.session.cwd || "default cwd"}</span>
          <code>{command}</code>
        </div>
      )}
      {(action || discardable) && (
        <div className="global-review-item-actions">
          {action && (
            <button
              type="button"
              className={`global-review-action action-${item.status.kind} ${relaunchNeedsReview ? "unsafe" : ""} ${armed ? "armed" : ""}`}
              onClick={runAction}
              disabled={hardBlocked || checking}
              aria-label={`${action} ${item.session.title} in ${item.workspaceLabel}`}
            >
              {item.status.kind === "error" || item.status.kind === "restored" || item.status.kind === "done" ? (
                <RotateCcw size={13} />
              ) : (
                <Play size={13} />
              )}
              <span>{action}</span>
            </button>
          )}
          {discardable && (
            <button
              type="button"
              className="global-review-discard"
              onClick={discardItem}
              aria-label={`Discard ${item.session.title} from ${item.workspaceLabel}`}
            >
              <X size={13} />
              <span>Discard</span>
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function reviewActionLabel(item: WorkspaceReviewItem, armed: boolean): string | null {
  if (item.status.kind === "checking") return "Checking";
  if (isLaunchBlocked(item.session)) return "Blocked";
  if (item.status.kind === "blocked") return armed ? "Confirm launch" : "Review command";
  if (item.status.kind === "staged") return "Launch";
  if (item.status.kind === "restored") {
    return sessionRelaunchSafety(item.session).safe ? "Relaunch" : armed ? "Confirm relaunch" : "Review relaunch";
  }
  if (item.status.kind === "error") {
    return sessionRelaunchSafety(item.session).safe ? "Restart" : armed ? "Confirm restart" : "Review restart";
  }
  if (item.status.kind === "done") {
    return sessionRelaunchSafety(item.session).safe ? "Restart" : armed ? "Confirm restart" : "Review restart";
  }
  return null;
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "button:not(:disabled)",
        "[href]",
        "input:not(:disabled)",
        "select:not(:disabled)",
        "textarea:not(:disabled)",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}
