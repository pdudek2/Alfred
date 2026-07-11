import { Play, ShieldAlert, X } from "lucide-react";
import type { AlfredStatus, SquadPlan } from "../alfred-state";
import { isLaunchBlocked, type SessionTile } from "../session-state";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import type { WorkspaceReviewItem } from "../workspace-attention";
import type { WorkspaceMissionBrief } from "../../shared/workspace-ipc";
import { shortenPath } from "../path-display";
import { formatCommand } from "../command-display";
import { recoveryCounts, recoveryStatusLabel } from "../recovery-display";

export type AlfredControlRailProps = {
  status: AlfredStatus;
  activeDecisionItems: WorkspaceReviewItem[];
  missionBrief: WorkspaceMissionBrief | undefined;
  pendingPlan: SquadPlan | null;
  recoverableSessions: SessionTile[];
  selectedSessionId: string | null;
  stagedSessions: SessionTile[];
  stagedCount: number;
  blockedStagedCount: number;
  liveAlfredCount: number;
  onApproveAll: () => void;
  onApproveTile: (tileId: string) => void;
  onDismissError: () => void;
  onFocusSession: (tileId: string) => void;
  onRejectAll: () => void;
  onRejectTile: (tileId: string) => void;
};

export function AlfredControlRail({
  status,
  activeDecisionItems,
  missionBrief,
  pendingPlan,
  recoverableSessions,
  selectedSessionId,
  stagedSessions,
  stagedCount,
  blockedStagedCount,
  liveAlfredCount,
  onApproveAll,
  onApproveTile,
  onDismissError,
  onFocusSession,
  onRejectAll,
  onRejectTile,
}: AlfredControlRailProps) {
  const checkingStagedCount = stagedSessions.filter((session) => session.stagedReviewStatus === "checking").length;
  const safeStagedCount = Math.max(0, stagedCount - blockedStagedCount - checkingStagedCount);
  const hasMissionBrief = isMissionBriefVisible(missionBrief);
  const compact =
    status.kind === "idle" &&
    pendingPlan === null &&
    recoverableSessions.length === 0 &&
    activeDecisionItems.length === 0 &&
    !hasMissionBrief;
  const sigilState = alfredSigilState(
    status,
    pendingPlan,
    recoverableSessions.length,
    blockedStagedCount,
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
            : hasMissionBrief
              ? "briefed"
          : "standing by";
  const footerLabel = pendingPlan
    ? "review queue"
    : activeDecisionItems.length > 0
        ? "decisions"
      : recoverableSessions.length > 0
        ? "recovery"
        : hasMissionBrief
          ? "mission"
        : "clear desk";
  const footerValue = safeStagedCount > 0
    ? `${safeStagedCount} launchable`
    : activeDecisionItems.length > 0
      ? `${activeDecisionItems.length} item${activeDecisionItems.length === 1 ? "" : "s"}`
      : recoverableSessions.length > 0
        ? `${recoverableSessions.length} item${recoverableSessions.length === 1 ? "" : "s"}`
        : hasMissionBrief
          ? "ready"
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
        <section className="alfred-dock-plan" aria-label="Alfred launch plan">
          <span className="plan-eyebrow">Workspace prepared</span>
          <div className="plan-name">{pendingPlan.name ?? "Squad"}</div>
          <div className="plan-counts">
            {stagedCount} staged · {liveAlfredCount} live
          </div>
          {blockedStagedCount > 0 && (
            <div className="plan-safety-note blocked" role="note">
              {blockedStagedCount} item{blockedStagedCount === 1 ? "" : "s"} blocked before launch.
            </div>
          )}
          {checkingStagedCount > 0 && (
            <div className="plan-safety-note checking" role="note">
              {checkingStagedCount} edited item{checkingStagedCount === 1 ? "" : "s"} being rechecked.
            </div>
          )}
          <p className="plan-prompt">"{truncate(pendingPlan.prompt, 140)}"</p>
          <PlanReviewQueue
            safeStagedCount={safeStagedCount}
            selectedSessionId={selectedSessionId}
            sessions={stagedSessions}
            blockedStagedCount={blockedStagedCount}
            checkingStagedCount={checkingStagedCount}
            onApproveAll={onApproveAll}
            onApproveTile={onApproveTile}
            onFocusSession={onFocusSession}
            onRejectAll={onRejectAll}
            onRejectTile={onRejectTile}
          />
        </section>
      ) : recoverableSessions.length > 0 || activeDecisionItems.length > 0 ? (
        <ReviewRecoveryContext
          activeDecisionItems={activeDecisionItems}
          recoverableSessions={recoverableSessions}
        />
      ) : hasMissionBrief ? (
        <MissionBriefSummary brief={missionBrief} />
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

function isMissionBriefVisible(brief: WorkspaceMissionBrief | undefined): brief is WorkspaceMissionBrief {
  return Boolean(brief && (brief.goal.trim() || brief.doneWhen.length > 0 || brief.guardrails.length > 0));
}

function MissionBriefSummary({ brief }: { brief: WorkspaceMissionBrief }) {
  const doneWhen = brief.doneWhen.slice(0, 2);
  const guardrails = brief.guardrails.slice(0, 2);

  return (
    <section className="mission-brief-card" aria-label="Workspace mission brief">
      <span className="mission-brief-kicker">Mission brief</span>
      <strong>{brief.goal || "Workspace intent set"}</strong>
      {doneWhen.length > 0 && (
        <div>
          <span>Done when</span>
          <ul>
            {doneWhen.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {guardrails.length > 0 && (
        <div>
          <span>Guardrails</span>
          <ul>
            {guardrails.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ReviewRecoveryContext({
  activeDecisionItems,
  recoverableSessions,
}: {
  activeDecisionItems: WorkspaceReviewItem[];
  recoverableSessions: SessionTile[];
}) {
  const firstDecision = activeDecisionItems[0] ?? null;
  const firstRecoverable = recoverableSessions[0] ?? null;
  const counts = recoveryCounts(recoverableSessions);
  const hasRecoveryContext = counts.saved > 0 || counts.ended > 0 || counts.failed > 0;
  const summary =
    activeDecisionItems.length > 0
      ? `${activeDecisionItems.length} decision${activeDecisionItems.length === 1 ? "" : "s"}`
      : hasRecoveryContext
        ? "Recovery context"
        : "No queued sessions";

  return (
    <section className="review-context-summary" aria-label="Review and recovery context">
      <header>
        <span>Session summary</span>
        <strong>{summary}</strong>
      </header>
      {firstDecision && <ReviewContextItem item={firstDecision} />}
      {firstRecoverable && (
        <RecoveryContextItem session={firstRecoverable} />
      )}
    </section>
  );
}

function ReviewContextItem({ item }: { item: WorkspaceReviewItem }) {
  const kind = sessionTileKind(item.session);
  const kindMeta = tileKindMeta(kind);

  return (
    <div className="review-context-item tone-decision">
      <span className={`review-kind ${kindMeta.className}`} title={kindMeta.label}>
        <TileKindIcon kind={kind} />
        <span>{kindMeta.shortLabel}</span>
      </span>
      <div>
        <strong>{item.session.title}</strong>
        <span>{item.status.label} · {item.detail}</span>
      </div>
    </div>
  );
}

function RecoveryContextItem({
  session,
}: {
  session: SessionTile;
}) {
  const kind = sessionTileKind(session);
  const kindMeta = tileKindMeta(kind);
  const statusLabel = recoveryStatusLabel(session);

  return (
    <div className="review-context-item tone-recovery">
      <span className={`review-kind ${kindMeta.className}`} title={kindMeta.label}>
        <TileKindIcon kind={kind} />
        <span>{kindMeta.shortLabel}</span>
      </span>
      <div>
        <strong>{session.title}</strong>
        <span>{statusLabel} · transcript context</span>
      </div>
    </div>
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
  blockedStagedCount: number,
  activeReviewCount: number,
): AlfredSigilState {
  if (status.kind === "error") return "error";
  if (blockedStagedCount > 0) return "ask";
  if (activeReviewCount > 0) return "ask";
  if (pendingPlan) return "active";
  if (recoverableCount > 0) return "recovery";
  if (status.kind === "thinking") return "active";
  return "idle";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function PlanReviewQueue({
  blockedStagedCount,
  checkingStagedCount,
  safeStagedCount,
  selectedSessionId,
  sessions,
  onApproveAll,
  onApproveTile,
  onFocusSession,
  onRejectAll,
  onRejectTile,
}: {
  blockedStagedCount: number;
  checkingStagedCount: number;
  safeStagedCount: number;
  selectedSessionId: string | null;
  sessions: SessionTile[];
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
          {safeStagedCount} safe
          {checkingStagedCount > 0 ? ` · ${checkingStagedCount} checking` : ""}
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
          <span>{blockedStagedCount > 0 ? "Launch safe" : "Launch queue"}</span>
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
  selected,
  session,
  onApprove,
  onFocus,
  onReject,
}: {
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
  const checking = session.stagedReviewStatus === "checking";
  const blockedDetail = hardBlocked ? blockedLaunchDetail(session) : null;
  const approveLabel = checking
    ? `Checking edited command from review queue: ${session.title}`
    : hardBlocked
      ? `Review details for blocked launch: ${session.title}`
    : `Launch from review queue: ${session.title}`;

  return (
    <li className={`review-queue-item ${checking ? "checking" : hardBlocked ? "blocked" : "safe"} ${selected ? "selected" : ""}`}>
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
        {checking && (
          <div className="review-safety-note checking">
            <ShieldAlert size={13} />
            <span>Rechecking edited command before launch.</span>
          </div>
        )}
        {hardBlocked && blockedDetail && (
          <div className="review-safety-note blocked">
            <ShieldAlert size={13} />
            <span>Cannot launch yet: {blockedDetail}</span>
          </div>
        )}
      </button>
      <div className="review-item-actions">
        <button
          type="button"
          className={checking ? "review-item-launch blocked" : "review-item-launch"}
          onClick={() => {
            if (hardBlocked) {
              onFocus(session.id);
              return;
            }
            onApprove(session.id);
          }}
          disabled={checking}
          aria-label={approveLabel}
        >
          {checking ? "Checking" : hardBlocked ? "Review details" : "Launch"}
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

function blockedLaunchDetail(session: Pick<SessionTile, "launchPreflight" | "safetyNote">): string {
  const safetyNote = session.safetyNote?.trim();
  if (safetyNote) return safetyNote;
  if (session.launchPreflight?.status === "blocked") return session.launchPreflight.reason;
  return "Preflight failed.";
}
