import { Play, RotateCcw, ShieldAlert, X } from "lucide-react";
import type { AlfredStatus, SquadPlan } from "../alfred-state";
import { isLaunchBlocked, type SessionTile } from "../session-state";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import type { WorkspaceReviewItem } from "../workspace-attention";

type AlfredControlRailProps = {
  armedUnsafeSessionIds: Set<string>;
  status: AlfredStatus;
  activeDecisionItems: WorkspaceReviewItem[];
  pendingPlan: SquadPlan | null;
  recoverableSessions: SessionTile[];
  selectedSessionId: string | null;
  stagedSessions: SessionTile[];
  stagedCount: number;
  blockedStagedCount: number;
  unsafeStagedCount: number;
  liveAlfredCount: number;
  onApproveAll: () => void;
  onApproveTile: (tileId: string) => void;
  onCloseRecoverableSessions: () => void;
  onCloseSession: (tileId: string) => void;
  onContinueRecoverableSessions: () => void;
  onContinueRestoredSession: (tileId: string) => void;
  onDismissError: () => void;
  onFocusSession: (tileId: string) => void;
  onRejectAll: () => void;
  onRejectTile: (tileId: string) => void;
  onRestartSession: (tileId: string) => void;
};

export function AlfredControlRail({
  armedUnsafeSessionIds,
  status,
  activeDecisionItems,
  pendingPlan,
  recoverableSessions,
  selectedSessionId,
  stagedSessions,
  stagedCount,
  blockedStagedCount,
  unsafeStagedCount,
  liveAlfredCount,
  onApproveAll,
  onApproveTile,
  onCloseRecoverableSessions,
  onCloseSession,
  onContinueRecoverableSessions,
  onContinueRestoredSession,
  onDismissError,
  onFocusSession,
  onRejectAll,
  onRejectTile,
  onRestartSession,
}: AlfredControlRailProps) {
  const safeStagedCount = Math.max(0, stagedCount - unsafeStagedCount - blockedStagedCount);
  const compact =
    status.kind === "idle" &&
    pendingPlan === null &&
    recoverableSessions.length === 0 &&
    activeDecisionItems.length === 0;
  const sigilState = alfredSigilState(
    status,
    pendingPlan,
    recoverableSessions.length,
    unsafeStagedCount,
    activeDecisionItems.length,
  );
  const statusText = status.kind === "thinking"
    ? "preparing"
    : status.kind === "error"
      ? "needs attention"
      : pendingPlan
        ? "ready to launch"
        : activeDecisionItems.length > 0
            ? "needs review"
          : recoverableSessions.length > 0
            ? "recovery ready"
          : "standing by";
  const footerLabel = pendingPlan
    ? "review queue"
    : activeDecisionItems.length > 0
        ? "decisions"
      : recoverableSessions.length > 0
        ? "recovery"
        : "clear desk";
  const footerValue = safeStagedCount > 0
    ? `${safeStagedCount} launchable`
    : activeDecisionItems.length > 0
      ? `${activeDecisionItems.length} item${activeDecisionItems.length === 1 ? "" : "s"}`
      : recoverableSessions.length > 0
        ? `${recoverableSessions.length} item${recoverableSessions.length === 1 ? "" : "s"}`
      : "no asks";

  return (
    <aside
      className={`alfred-dock ${compact ? "compact" : ""}`}
      aria-label="Alfred status"
      title={compact ? "Alfred standing by" : undefined}
    >
      <div className="alfred-dock-header">
        <AlfredSigil state={sigilState} />
        {compact && <span className="visually-hidden">Alfred {statusText}</span>}
        {!compact && (
          <div>
            <strong>Alfred</strong>
            <span>{statusText}</span>
          </div>
        )}
      </div>

      {!compact && (status.kind === "error" ? (
        <div className="alfred-dock-error" role="alert">
          <div>{status.error.message}</div>
          <button type="button" className="dismiss" onClick={onDismissError} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      ) : pendingPlan ? (
        <div className="alfred-dock-plan">
          <div className="plan-name">{pendingPlan.name ?? "Squad"}</div>
          <div className="plan-counts">
            {stagedCount} staged · {liveAlfredCount} live
          </div>
          {unsafeStagedCount > 0 && (
            <div className="plan-safety-note" role="note">
              {unsafeStagedCount} flagged item{unsafeStagedCount === 1 ? "" : "s"} need manual approval.
            </div>
          )}
          {blockedStagedCount > 0 && (
            <div className="plan-safety-note blocked" role="note">
              {blockedStagedCount} item{blockedStagedCount === 1 ? "" : "s"} blocked before launch.
            </div>
          )}
          <p className="plan-prompt">"{truncate(pendingPlan.prompt, 140)}"</p>
          <PlanReviewQueue
            armedUnsafeSessionIds={armedUnsafeSessionIds}
            safeStagedCount={safeStagedCount}
            selectedSessionId={selectedSessionId}
            sessions={stagedSessions}
            blockedStagedCount={blockedStagedCount}
            unsafeStagedCount={unsafeStagedCount}
            onApproveAll={onApproveAll}
            onApproveTile={onApproveTile}
            onFocusSession={onFocusSession}
            onRejectAll={onRejectAll}
            onRejectTile={onRejectTile}
          />
        </div>
      ) : recoverableSessions.length > 0 || activeDecisionItems.length > 0 ? (
        <div className="alfred-dock-queues">
          {activeDecisionItems.length > 0 && (
            <ActiveDecisionQueue
              armedUnsafeSessionIds={armedUnsafeSessionIds}
              items={activeDecisionItems}
              selectedSessionId={selectedSessionId}
              onApproveTile={onApproveTile}
              onContinueRestoredSession={onContinueRestoredSession}
              onFocusSession={onFocusSession}
              onRejectTile={onRejectTile}
              onRestartSession={onRestartSession}
            />
          )}
          {recoverableSessions.length > 0 && (
            <RecoveryQueue
              selectedSessionId={selectedSessionId}
              sessions={recoverableSessions}
              onCloseAllSessions={onCloseRecoverableSessions}
              onCloseSession={onCloseSession}
              onContinueAllSessions={onContinueRecoverableSessions}
              onContinueRestoredSession={onContinueRestoredSession}
              onFocusSession={onFocusSession}
              onRestartSession={onRestartSession}
            />
          )}
        </div>
      ) : (
        <p>Manual work stays in front. Ask Alfred when you want a workspace prepared.</p>
      ))}

      {!compact && (
        <div className="alfred-dock-footer">
          <span>{footerLabel}</span>
          <span>{footerValue}</span>
        </div>
      )}
    </aside>
  );
}

type AlfredSigilState = "idle" | "active" | "ask" | "error" | "recovery";

function AlfredSigil({ state }: { state: AlfredSigilState }) {
  return (
    <div className={`alfred-sigil state-${state}`} aria-hidden="true">
      <span />
      <i />
      <b>A</b>
    </div>
  );
}

function alfredSigilState(
  status: AlfredStatus,
  pendingPlan: SquadPlan | null,
  recoverableCount: number,
  unsafeStagedCount: number,
  activeReviewCount: number,
): AlfredSigilState {
  if (status.kind === "error") return "error";
  if (unsafeStagedCount > 0) return "ask";
  if (activeReviewCount > 0) return "ask";
  if (pendingPlan) return "active";
  if (recoverableCount > 0) return "recovery";
  if (status.kind === "thinking") return "active";
  return "idle";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function RecoveryQueue({
  selectedSessionId,
  sessions,
  onCloseAllSessions,
  onCloseSession,
  onContinueAllSessions,
  onContinueRestoredSession,
  onFocusSession,
  onRestartSession,
}: {
  selectedSessionId: string | null;
  sessions: SessionTile[];
  onCloseAllSessions: () => void;
  onCloseSession: (tileId: string) => void;
  onContinueAllSessions: () => void;
  onContinueRestoredSession: (tileId: string) => void;
  onFocusSession: (tileId: string) => void;
  onRestartSession: (tileId: string) => void;
}) {
  return (
    <section className="recovery-queue" aria-label="Recovery queue">
      <header>
        <span>Recovery</span>
        <strong>{sessions.length} saved</strong>
        {sessions.length > 1 && (
          <div className="recovery-queue-actions">
            <button type="button" onClick={onContinueAllSessions}>
              Relaunch all
            </button>
            <button type="button" onClick={onCloseAllSessions}>
              Dismiss all
            </button>
          </div>
        )}
      </header>
      <ol>
        {sessions.map((session) => (
          <RecoveryQueueItem
            key={session.id}
            selected={session.id === selectedSessionId}
            session={session}
            onCloseSession={onCloseSession}
            onContinueRestoredSession={onContinueRestoredSession}
            onFocusSession={onFocusSession}
            onRestartSession={onRestartSession}
          />
        ))}
      </ol>
    </section>
  );
}

function RecoveryQueueItem({
  selected,
  session,
  onCloseSession,
  onContinueRestoredSession,
  onFocusSession,
  onRestartSession,
}: {
  selected: boolean;
  session: SessionTile;
  onCloseSession: (tileId: string) => void;
  onContinueRestoredSession: (tileId: string) => void;
  onFocusSession: (tileId: string) => void;
  onRestartSession: (tileId: string) => void;
}) {
  const kind = sessionTileKind(session);
  const kindMeta = tileKindMeta(kind);
  const actionLabel = session.runtimeStatus === "restored" ? "Relaunch" : "Restart";
  const action = session.runtimeStatus === "restored" ? onContinueRestoredSession : onRestartSession;
  const statusLabel = recoveryStatusLabel(session);

  return (
    <li className={`recovery-item status-${statusLabel} ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className="recovery-item-focus"
        onClick={() => onFocusSession(session.id)}
        aria-label={`Focus recoverable session: ${session.title}`}
      >
        <span className={`review-kind ${kindMeta.className}`} title={kindMeta.label}>
          <TileKindIcon kind={kind} />
          <span>{kindMeta.shortLabel}</span>
        </span>
        <div>
          <strong>{session.title}</strong>
          <span>{statusLabel} · {session.cwd ? shortenPath(session.cwd) : "default cwd"}</span>
        </div>
      </button>
      <div className="recovery-item-actions">
        <button
          type="button"
          className="recovery-action"
          onClick={() => action(session.id)}
          aria-label={`${actionLabel} ${session.title}`}
        >
          {session.runtimeStatus === "restored" ? <Play size={13} /> : <RotateCcw size={13} />}
          <span>{actionLabel}</span>
        </button>
        <button
          type="button"
          className="recovery-dismiss"
          onClick={() => onCloseSession(session.id)}
          aria-label={`Dismiss ${session.title}`}
        >
          <X size={13} />
        </button>
      </div>
    </li>
  );
}

function ActiveDecisionQueue({
  armedUnsafeSessionIds,
  items,
  selectedSessionId,
  onApproveTile,
  onContinueRestoredSession,
  onFocusSession,
  onRejectTile,
  onRestartSession,
}: {
  armedUnsafeSessionIds: Set<string>;
  items: WorkspaceReviewItem[];
  selectedSessionId: string | null;
  onApproveTile: (tileId: string) => void;
  onContinueRestoredSession: (tileId: string) => void;
  onFocusSession: (tileId: string) => void;
  onRejectTile: (tileId: string) => void;
  onRestartSession: (tileId: string) => void;
}) {
  return (
    <section className="review-queue active-decisions" aria-label="Current workspace decisions">
      <header>
        <span>Needs review</span>
        <strong>{items.length} item{items.length === 1 ? "" : "s"}</strong>
      </header>
      <ol>
        {items.map((item) => (
          <ActiveDecisionItem
            armed={armedUnsafeSessionIds.has(item.session.id)}
            item={item}
            key={item.id}
            selected={item.session.id === selectedSessionId}
            onApproveTile={onApproveTile}
            onContinueRestoredSession={onContinueRestoredSession}
            onFocusSession={onFocusSession}
            onRejectTile={onRejectTile}
            onRestartSession={onRestartSession}
          />
        ))}
      </ol>
    </section>
  );
}

function ActiveDecisionItem({
  armed,
  item,
  selected,
  onApproveTile,
  onContinueRestoredSession,
  onFocusSession,
  onRejectTile,
  onRestartSession,
}: {
  armed: boolean;
  item: WorkspaceReviewItem;
  selected: boolean;
  onApproveTile: (tileId: string) => void;
  onContinueRestoredSession: (tileId: string) => void;
  onFocusSession: (tileId: string) => void;
  onRejectTile: (tileId: string) => void;
  onRestartSession: (tileId: string) => void;
}) {
  const session = item.session;
  const kind = sessionTileKind(session);
  const kindMeta = tileKindMeta(kind);
  const actionLabel = decisionActionLabel(item, armed);
  const canReject = item.status.kind === "blocked" || item.status.kind === "staged";
  const hardBlocked = isLaunchBlocked(session);

  const runAction = () => {
    if (hardBlocked) return;
    if (item.status.kind === "blocked" || item.status.kind === "staged") {
      onApproveTile(session.id);
      return;
    }

    if (item.status.kind === "restored") {
      onContinueRestoredSession(session.id);
      return;
    }

    if (item.status.kind === "error") {
      onRestartSession(session.id);
      return;
    }

    onFocusSession(session.id);
  };

  return (
    <li className={`review-queue-item decision-item tone-${item.status.kind} ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className="review-item-focus"
        onClick={() => onFocusSession(session.id)}
        aria-label={`Focus decision: ${session.title}`}
      >
        <div className="review-item-head">
          <span className={`review-kind ${kindMeta.className}`} title={kindMeta.label}>
            <TileKindIcon kind={kind} />
            <span>{kindMeta.shortLabel}</span>
          </span>
          <div>
            <strong>{session.title}</strong>
            <span>{item.status.label} · {session.cwd ? shortenPath(session.cwd) : "default cwd"}</span>
          </div>
        </div>
        <p className="decision-detail">{item.detail}</p>
      </button>
      <div className={`review-item-actions ${canReject ? "" : "solo"}`}>
        <button
          type="button"
          className={hardBlocked ? "review-item-launch blocked" : session.safetyNote ? "review-item-launch flagged" : "review-item-launch"}
          onClick={runAction}
          disabled={hardBlocked}
          aria-label={`${actionLabel} ${session.title}`}
        >
          {actionLabel}
        </button>
        {canReject && (
          <button
            type="button"
            className="review-item-reject"
            onClick={() => onRejectTile(session.id)}
            aria-label={`Remove decision: ${session.title}`}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </li>
  );
}

function decisionActionLabel(item: WorkspaceReviewItem, armed: boolean): string {
  if (isLaunchBlocked(item.session)) return "Blocked";
  if (item.status.kind === "blocked") return armed ? "Confirm" : "Review";
  if (item.status.kind === "staged") return "Launch";
  if (item.status.kind === "restored") return "Relaunch";
  if (item.status.kind === "error") return "Restart";
  return "Open";
}

function recoveryStatusLabel(session: SessionTile): "done" | "error" | "restored" {
  if (session.runtimeStatus === "error") return "error";
  if (session.runtimeStatus === "restored") return "restored";
  return "done";
}

function PlanReviewQueue({
  armedUnsafeSessionIds,
  blockedStagedCount,
  safeStagedCount,
  selectedSessionId,
  sessions,
  unsafeStagedCount,
  onApproveAll,
  onApproveTile,
  onFocusSession,
  onRejectAll,
  onRejectTile,
}: {
  armedUnsafeSessionIds: Set<string>;
  blockedStagedCount: number;
  safeStagedCount: number;
  selectedSessionId: string | null;
  sessions: SessionTile[];
  unsafeStagedCount: number;
  onApproveAll: () => void;
  onApproveTile: (tileId: string) => void;
  onFocusSession: (tileId: string) => void;
  onRejectAll: () => void;
  onRejectTile: (tileId: string) => void;
}) {
  if (sessions.length === 0) {
    return <p className="review-queue-empty">No staged sessions remain.</p>;
  }

  return (
    <section className="review-queue" aria-label="Alfred review queue">
      <header>
        <span>Review queue</span>
        <strong>
          {safeStagedCount} safe · {unsafeStagedCount} flagged
          {blockedStagedCount > 0 ? ` · ${blockedStagedCount} blocked` : ""}
        </strong>
      </header>
      <div className="review-queue-actions">
        <button
          type="button"
          className="review-launch"
          onClick={onApproveAll}
          disabled={safeStagedCount === 0}
        >
          <Play size={13} />
          <span>{unsafeStagedCount > 0 ? "Launch safe" : "Launch queue"}</span>
        </button>
        <button
          type="button"
          className="review-clear"
          onClick={onRejectAll}
          aria-label="Clear staged plan from review queue"
        >
          Clear
        </button>
      </div>
      <ol>
        {sessions.map((session) => (
          <ReviewQueueItem
            armed={armedUnsafeSessionIds.has(session.id)}
            key={session.id}
            selected={session.id === selectedSessionId}
            session={session}
            onApprove={onApproveTile}
            onFocus={onFocusSession}
            onReject={onRejectTile}
          />
        ))}
      </ol>
    </section>
  );
}

function ReviewQueueItem({
  armed,
  selected,
  session,
  onApprove,
  onFocus,
  onReject,
}: {
  armed: boolean;
  selected: boolean;
  session: SessionTile;
  onApprove: (tileId: string) => void;
  onFocus: (tileId: string) => void;
  onReject: (tileId: string) => void;
}) {
  const kind = sessionTileKind(session);
  const kindMeta = tileKindMeta(kind);
  const command = formatCommand(session);
  const hardBlocked = isLaunchBlocked(session);
  const flagged = Boolean(session.safetyNote) && !hardBlocked;
  const approveLabel = flagged
    ? armed
      ? `Confirm unsafe command from review queue: ${session.title}`
      : `Review unsafe command from review queue: ${session.title}`
    : hardBlocked
      ? `Launch blocked from review queue: ${session.title}`
    : `Launch from review queue: ${session.title}`;

  return (
    <li className={`review-queue-item ${hardBlocked ? "blocked" : flagged ? "flagged" : "safe"} ${armed ? "armed" : ""} ${selected ? "selected" : ""}`}>
      <button
        type="button"
        className="review-item-focus"
        onClick={() => onFocus(session.id)}
        aria-label={`Focus staged tile: ${session.title}`}
      >
        <div className="review-item-head">
          <span className={`review-kind ${kindMeta.className}`} title={kindMeta.label}>
            <TileKindIcon kind={kind} />
            <span>{kindMeta.shortLabel}</span>
          </span>
          <div>
            <strong>{session.title}</strong>
            <span>{session.cwd ? shortenPath(session.cwd) : "default cwd"}</span>
          </div>
        </div>
        <code>{command}</code>
        {hardBlocked && session.launchPreflight?.status === "blocked" && (
          <div className="review-safety-note blocked">
            <ShieldAlert size={13} />
            <span>{session.launchPreflight.reason}</span>
          </div>
        )}
        {flagged && session.safetyNote && (
          <div className="review-safety-note">
            <ShieldAlert size={13} />
            <span>{session.safetyNote}</span>
          </div>
        )}
      </button>
      <div className="review-item-actions">
        <button
          type="button"
          className={hardBlocked ? "review-item-launch blocked" : flagged ? "review-item-launch flagged" : "review-item-launch"}
          onClick={() => onApprove(session.id)}
          disabled={hardBlocked}
          aria-label={approveLabel}
        >
          {hardBlocked ? "Blocked" : flagged ? (armed ? "Confirm" : "Review") : "Launch"}
        </button>
        <button
          type="button"
          className="review-item-reject"
          onClick={() => onReject(session.id)}
          aria-label={`Remove from review queue: ${session.title}`}
        >
          <X size={13} />
        </button>
      </div>
    </li>
  );
}

function formatCommand(session: SessionTile): string {
  const command = session.command?.trim();
  const args = session.args ?? [];
  if (!command) return "interactive shell";
  return [command, ...args].join(" ");
}

function shortenPath(value: string): string {
  const parts = value.split("/");
  if (parts.length <= 3) return value;
  return `…/${parts.slice(-2).join("/")}`;
}
