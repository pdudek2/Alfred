import { Play, ShieldAlert, X } from "lucide-react";
import type { AlfredStatus, SquadPlan } from "../alfred-state";
import type { SessionTile } from "../session-state";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";

type AlfredControlRailProps = {
  armedUnsafeSessionIds: Set<string>;
  status: AlfredStatus;
  pendingPlan: SquadPlan | null;
  stagedSessions: SessionTile[];
  stagedCount: number;
  unsafeStagedCount: number;
  liveAlfredCount: number;
  onApproveAll: () => void;
  onApproveTile: (tileId: string) => void;
  onDismissError: () => void;
  onRejectAll: () => void;
  onRejectTile: (tileId: string) => void;
};

export function AlfredControlRail({
  armedUnsafeSessionIds,
  status,
  pendingPlan,
  stagedSessions,
  stagedCount,
  unsafeStagedCount,
  liveAlfredCount,
  onApproveAll,
  onApproveTile,
  onDismissError,
  onRejectAll,
  onRejectTile,
}: AlfredControlRailProps) {
  const safeStagedCount = Math.max(0, stagedCount - unsafeStagedCount);
  const compact = status.kind === "idle" && pendingPlan === null;

  return (
    <aside className={`alfred-dock ${compact ? "compact" : ""}`} aria-label="Alfred status">
      <div className="alfred-dock-header">
        <div className="alfred-dock-mark">A</div>
        <div>
          <strong>Alfred</strong>
          <span>{status.kind === "thinking" ? "preparing" : status.kind === "error" ? "needs attention" : pendingPlan ? "ready to launch" : "standing by"}</span>
        </div>
      </div>

      {status.kind === "error" ? (
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
          <p className="plan-prompt">"{truncate(pendingPlan.prompt, 140)}"</p>
          <PlanReviewQueue
            armedUnsafeSessionIds={armedUnsafeSessionIds}
            safeStagedCount={safeStagedCount}
            sessions={stagedSessions}
            unsafeStagedCount={unsafeStagedCount}
            onApproveAll={onApproveAll}
            onApproveTile={onApproveTile}
            onRejectAll={onRejectAll}
            onRejectTile={onRejectTile}
          />
        </div>
      ) : compact ? (
        <p className="compact-note" aria-label="Alfred idle">
          Quiet until asked.
        </p>
      ) : (
        <p>Manual work stays in front. Ask Alfred when you want a workspace prepared.</p>
      )}

      <div className="alfred-dock-footer">
        <span>{pendingPlan ? "review queue" : "clear desk"}</span>
        <span>{safeStagedCount > 0 ? `${safeStagedCount} launchable` : "no asks"}</span>
      </div>
    </aside>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function PlanReviewQueue({
  armedUnsafeSessionIds,
  safeStagedCount,
  sessions,
  unsafeStagedCount,
  onApproveAll,
  onApproveTile,
  onRejectAll,
  onRejectTile,
}: {
  armedUnsafeSessionIds: Set<string>;
  safeStagedCount: number;
  sessions: SessionTile[];
  unsafeStagedCount: number;
  onApproveAll: () => void;
  onApproveTile: (tileId: string) => void;
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
            session={session}
            onApprove={onApproveTile}
            onReject={onRejectTile}
          />
        ))}
      </ol>
    </section>
  );
}

function ReviewQueueItem({
  armed,
  session,
  onApprove,
  onReject,
}: {
  armed: boolean;
  session: SessionTile;
  onApprove: (tileId: string) => void;
  onReject: (tileId: string) => void;
}) {
  const kind = sessionTileKind(session);
  const kindMeta = tileKindMeta(kind);
  const command = formatCommand(session);
  const flagged = Boolean(session.safetyNote);
  const approveLabel = flagged
    ? armed
      ? `Confirm unsafe command from review queue: ${session.title}`
      : `Review unsafe command from review queue: ${session.title}`
    : `Launch from review queue: ${session.title}`;

  return (
    <li className={`review-queue-item ${flagged ? "flagged" : "safe"} ${armed ? "armed" : ""}`}>
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
      {session.safetyNote && (
        <div className="review-safety-note">
          <ShieldAlert size={13} />
          <span>{session.safetyNote}</span>
        </div>
      )}
      <div className="review-item-actions">
        <button
          type="button"
          className={flagged ? "review-item-launch flagged" : "review-item-launch"}
          onClick={() => onApprove(session.id)}
          aria-label={approveLabel}
        >
          {flagged ? (armed ? "Confirm" : "Review") : "Launch"}
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
