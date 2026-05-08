import type { AlfredStatus, SquadPlan } from "../alfred-state";

type AlfredControlRailProps = {
  status: AlfredStatus;
  pendingPlan: SquadPlan | null;
  stagedCount: number;
  unsafeStagedCount: number;
  liveAlfredCount: number;
  onDismissError: () => void;
};

export function AlfredControlRail({
  status,
  pendingPlan,
  stagedCount,
  unsafeStagedCount,
  liveAlfredCount,
  onDismissError,
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
