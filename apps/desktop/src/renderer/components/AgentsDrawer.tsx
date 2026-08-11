import { ArrowLeft, ArrowRight, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { buildAgentHandoffDetail, recentHandoffItems } from "../agent-handoff";
import type { AttentionProjection } from "../attention-projection";
import { presentActivityEvents } from "../activity-presentation";
import { isActiveAgentSession } from "../session-scope";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { TileKindIcon } from "../tile-kind-icon";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { attentionActionLabel } from "./InboxDecisionItem";
import "./agents-drawer.css";

type AgentsDrawerWorkspace = {
  id: string;
  label: string;
};

export type AgentsDrawerProps = {
  sessions: SessionTile[];
  activeSessionId: string | null;
  activeWorkspaceId: string;
  attentionItems: AttentionProjection[];
  dismissalSuspended?: boolean;
  open: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  workspaces: AgentsDrawerWorkspace[];
  onClose: () => void;
  onOpenInbox: () => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onOpenWorktreeDiff: (workspaceId: string, sessionId: string) => void;
  onRunAttentionAction: (item: AttentionProjection) => void;
};

export function AgentsDrawer({
  sessions,
  activeSessionId,
  activeWorkspaceId,
  attentionItems,
  dismissalSuspended = false,
  open,
  returnFocusRef,
  workspaces,
  onClose,
  onOpenInbox,
  onOpenSession,
  onOpenWorktreeDiff,
  onRunAttentionAction,
}: AgentsDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const handoffReturnIdRef = useRef<string | null>(null);
  const restoreHandoffFocusRef = useRef(false);
  const restoreFocusOnCloseRef = useRef(false);
  const wasOpenRef = useRef(open);
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);
  const decisions = attentionItems.filter((item) => item.blocksAgent);
  const recentHandoffs = recentHandoffItems(attentionItems);
  const workspaceLabels = new Map(workspaces.map((workspace) => [workspace.id, workspace.label]));
  const inProgress = sessions.filter(isActiveAgentSession)
    .sort((left, right) => activityAt(right) - activityAt(left)
      || `${left.workspaceId}:${left.id}`.localeCompare(`${right.workspaceId}:${right.id}`));
  const selectedHandoff = selectedHandoffId === null
    ? null
    : attentionItems.find((item) => item.id === selectedHandoffId) ?? null;
  const selectedSession = selectedHandoff === null
    ? null
    : sessions.find((session) => (
      session.workspaceId === selectedHandoff.workspaceId && session.id === selectedHandoff.sessionId
    )) ?? null;
  const handoff = selectedHandoff && selectedSession
    ? buildAgentHandoffDetail(selectedHandoff, selectedSession)
    : null;

  const requestClose = useCallback(() => {
    restoreFocusOnCloseRef.current = true;
    setSelectedHandoffId(null);
    onClose();
  }, [onClose]);

  const returnToAgents = useCallback(() => {
    restoreHandoffFocusRef.current = true;
    setSelectedHandoffId(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || dismissalSuspended) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (selectedHandoffId !== null) {
        returnToAgents();
      } else {
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [dismissalSuspended, open, requestClose, returnToAgents, selectedHandoffId]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!wasOpen || open || !restoreFocusOnCloseRef.current) return;
    restoreFocusOnCloseRef.current = false;
    const frame = requestAnimationFrame(() => returnFocusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, returnFocusRef]);

  useEffect(() => {
    if (selectedHandoffId !== null || !restoreHandoffFocusRef.current) return;
    restoreHandoffFocusRef.current = false;
    const frame = requestAnimationFrame(() => {
      const originId = handoffReturnIdRef.current;
      const origin = [...document.querySelectorAll<HTMLButtonElement>("[data-handoff-id]")]
        .find((button) => button.dataset.handoffId === originId);
      origin?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedHandoffId]);

  return (
    <aside
      className={`agents-drawer ${open ? "open" : "closed"}`}
      aria-label="Agents"
      aria-hidden={open ? "false" : "true"}
      data-testid="agents-drawer"
      inert={!open || undefined}
    >
      <header className="agents-drawer__header">
        {handoff ? (
          <button type="button" className="agents-drawer__back" aria-label="Back to Agents" onClick={returnToAgents}>
            <ArrowLeft aria-hidden="true" size={15} />
            <span>Back</span>
          </button>
        ) : <h2>Agents</h2>}
        {handoff && <h2>Handoff</h2>}
        <button ref={closeButtonRef} type="button" aria-label="Close Agents" onClick={requestClose}>
          <X aria-hidden="true" size={15} />
        </button>
      </header>

      <div className="agents-drawer__body">
        {handoff && selectedHandoff ? (
          <HandoffDetail
            detail={handoff}
            item={selectedHandoff}
            onOpenWorktreeDiff={onOpenWorktreeDiff}
            onRunAttentionAction={() => {
              if (selectedHandoff.action.kind === "launch") restoreFocusOnCloseRef.current = true;
              onRunAttentionAction(selectedHandoff);
            }}
          />
        ) : (
          <>
            <section className="agents-drawer__section" aria-labelledby="agents-needs-decision">
              <header>
                <h3 id="agents-needs-decision">Needs a decision</h3>
                <span>{decisions.length}</span>
              </header>
              {decisions.length === 0 ? (
                <p className="agents-drawer__empty">No decisions waiting.</p>
              ) : (
                <div className="agents-drawer__decision-list">
                  {decisions.map((item) => (
                    <article className="agents-drawer__decision" key={item.id}>
                      <span className="agents-drawer__decision-mark" aria-hidden="true">
                        <TriangleAlert size={13} strokeWidth={1.9} />
                      </span>
                      <div className="agents-drawer__decision-copy">
                        <div>
                          <strong>{item.sessionTitle}</strong>
                          <small>{item.workspaceLabel}</small>
                        </div>
                        <p title={item.reason}>{item.reason}</p>
                      </div>
                      <button
                        type="button"
                        data-handoff-id={item.id}
                        aria-label={`Review handoff for ${item.sessionTitle}`}
                        onClick={() => {
                          handoffReturnIdRef.current = item.id;
                          setSelectedHandoffId(item.id);
                        }}
                      >
                        Review handoff
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {recentHandoffs.length > 0 && (
              <section className="agents-drawer__section" aria-labelledby="agents-recent-handoffs">
                <header>
                  <h3 id="agents-recent-handoffs">Recent handoffs</h3>
                  <span>{recentHandoffs.length}</span>
                </header>
                <div className="agents-drawer__handoff-list">
                  {recentHandoffs.map((item) => {
                    const session = sessions.find((candidate) => (
                      candidate.workspaceId === item.workspaceId && candidate.id === item.sessionId
                    ));
                    if (!session) return null;
                    const kind = agentKindFor(session);
                    return (
                      <button
                        type="button"
                        key={item.id}
                        data-handoff-id={item.id}
                        aria-label={`Review handoff for ${item.sessionTitle}`}
                        onClick={() => {
                          handoffReturnIdRef.current = item.id;
                          setSelectedHandoffId(item.id);
                        }}
                      >
                        <span className={`agents-drawer__agent-mark kind-${kind}`} aria-hidden="true">
                          <TileKindIcon kind={kind} size={13} />
                        </span>
                        <span className="agents-drawer__handoff-copy">
                          <strong>{item.sessionTitle}</strong>
                          <small>{item.workspaceLabel}</small>
                        </span>
                        <span className="agents-drawer__handoff-state">{buildAgentHandoffDetail(item, session).stateLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="agents-drawer__section" aria-labelledby="agents-in-progress">
              <header>
                <h3 id="agents-in-progress">In progress</h3>
                <span>{inProgress.length}</span>
              </header>
              {inProgress.length === 0 ? (
                <p className="agents-drawer__empty">No agents running.</p>
              ) : (
                <div className="agents-drawer__work-list">
                  {inProgress.map((session) => {
                    const workspaceLabel = workspaceLabels.get(session.workspaceId) ?? session.workspaceId;
                    const kind = agentKindFor(session);
                    const agentLabel = tileKindMeta(kind).label;
                    const detail = latestAgentDetail(session);
                    const selected = session.workspaceId === activeWorkspaceId && session.id === activeSessionId;
                    return (
                      <button
                        type="button"
                        className={selected ? "is-selected" : undefined}
                        aria-current={selected ? "true" : undefined}
                        aria-label={`Open ${session.title} in ${workspaceLabel}`}
                        key={`${session.workspaceId}:${session.id}`}
                        onClick={() => onOpenSession(session.workspaceId, session.id)}
                      >
                        <span className={`agents-drawer__agent-mark kind-${kind}`} aria-hidden="true">
                          <TileKindIcon kind={kind} size={13} />
                        </span>
                        <span className="agents-drawer__work-copy">
                          <strong>{session.title}</strong>
                          <small>
                            {workspaceLabel} · {agentLabel}
                            <span className="agents-drawer__work-detail" title={detail}> · {detail}</span>
                          </small>
                        </span>
                        <span className="agents-drawer__open-label" aria-hidden="true">Open</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <footer className="agents-drawer__footer">
        <span className="agents-drawer__footer-label">Inbox</span>
        <button type="button" aria-label="Open full Inbox queue" onClick={onOpenInbox}>
          <span>Open full queue</span>
          <ArrowRight aria-hidden="true" size={13} />
        </button>
      </footer>
    </aside>
  );
}

function HandoffDetail({
  detail,
  item,
  onOpenWorktreeDiff,
  onRunAttentionAction,
}: {
  detail: ReturnType<typeof buildAgentHandoffDetail>;
  item: AttentionProjection;
  onOpenWorktreeDiff: (workspaceId: string, sessionId: string) => void;
  onRunAttentionAction: () => void;
}) {
  return (
    <section className="agents-drawer__handoff" aria-labelledby="agents-handoff-title">
      <div className="agents-drawer__handoff-intro">
        <h3 id="agents-handoff-title">{detail.sessionTitle}</h3>
        <p>{detail.outcome}</p>
      </div>
      {detail.decision && (
        <section className="agents-drawer__handoff-decision" aria-labelledby="agents-handoff-decision">
          <h4 id="agents-handoff-decision">Decision</h4>
          <p>{detail.decision}</p>
        </section>
      )}
      <section className="agents-drawer__handoff-evidence" aria-labelledby="agents-handoff-evidence">
        <h4 id="agents-handoff-evidence">Evidence</h4>
        <dl>
          <div>
            <dt>Status</dt>
            <dd className={`is-${detail.stateTone}`}>{detail.stateLabel}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>{detail.workspaceLabel}</dd>
          </div>
          {detail.branchName && (
            <div>
              <dt>Branch</dt>
              <dd className="agents-drawer__handoff-mono">{detail.branchName}</dd>
            </div>
          )}
        </dl>
      </section>
      {detail.activity.length > 0 && (
        <section className="agents-drawer__handoff-changes" aria-labelledby="agents-handoff-changes">
          <h4 id="agents-handoff-changes">What changed</h4>
          <ul>
            {detail.activity.slice(0, 3).map((activity) => (
              <li key={activity.id}>
                <strong>{activity.title}</strong>
                <span>{activity.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="agents-drawer__handoff-actions">
        <button type="button" className="agents-drawer__handoff-primary" onClick={onRunAttentionAction}>
          {attentionActionLabel(item)} {detail.sessionTitle}
        </button>
        {detail.canReviewDiff && (
          <button type="button" onClick={() => onOpenWorktreeDiff(detail.workspaceId, detail.sessionId)}>
            Open diff
          </button>
        )}
      </div>
    </section>
  );
}

function agentKindFor(session: SessionTile): "claude" | "codex" {
  const detectedKind = sessionTileKind(session);
  if (detectedKind === "codex" || detectedKind === "claude") return detectedKind;
  return session.command === "claude" ? "claude" : "codex";
}

function activityAt(session: SessionTile): number {
  return session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt ?? 0;
}

function latestAgentDetail(session: SessionTile): string {
  const status = terminalSessionDisplayStatus(session);
  const event = presentActivityEvents(session.activityEvents ?? [], { limit: 1 }).visibleEvents[0];
  const approvalWasSuperseded = event?.kind === "approval"
    && status.kind === "active"
    && session.lastOutputAt !== undefined
    && session.lastOutputAt > event.at;
  if (event?.detail.trim() && !approvalWasSuperseded) return event.detail.trim();

  if (status.kind === "starting") return "Starting";
  if (status.kind === "active") return "Working";
  return status.kind === "idle" ? "Quiet" : status.label;
}
