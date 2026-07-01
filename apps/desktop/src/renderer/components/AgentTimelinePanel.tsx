import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AlfredStagedSessionPatch } from "../../shared/alfred-ipc";
import { meaningfulSignalEvents, presentActivityEvents } from "../activity-presentation";
import type { SessionActivityEvent, SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { shortenWorktreeLabel } from "../path-display";
import { SessionStatusGlyph } from "./SessionStatusGlyph";

export type AgentTimelinePanelProps = {
  onCopyActivityText?: (value: string) => Promise<void> | void;
  onOpenExternalTerminal?: (cwd: string) => Promise<void> | void;
  onRevealActivityFile?: (filePath: string, cwd: string) => Promise<void> | void;
  onUpdateStagedSession?: (sessionId: string, patch: AlfredStagedSessionPatch) => Promise<void>;
  session: SessionTile | null;
};

export function AgentTimelinePanel({
  onCopyActivityText,
  onOpenExternalTerminal,
  onRevealActivityFile,
  onUpdateStagedSession,
  session,
}: AgentTimelinePanelProps) {
  const ageClock = useSessionAgeClock(session?.createdAt);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState<StagedEditDraft>(() => emptyEditDraft());
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [payloadActionState, setPayloadActionState] = useState<Record<string, string>>({});
  const [sessionActionState, setSessionActionState] = useState<Record<string, string>>({});
  const [showRawActivity, setShowRawActivity] = useState(false);

  useEffect(() => {
    setEditMode(false);
    setEditDraft(emptyEditDraft());
    setEditError(null);
    setEditSaving(false);
    setPayloadActionState({});
    setSessionActionState({});
    setShowRawActivity(false);
  }, [session?.id]);

  useEffect(() => {
    if (!editMode) return;
    commandInputRef.current?.focus();
  }, [editMode]);

  if (!session) {
    return (
      <aside className="agent-timeline-panel" aria-label="Agent activity">
        <header className="agent-timeline-header">
          <strong>Activity</strong>
          <span>no selected session</span>
        </header>
        <div className="agent-timeline-body">
          <p className="agent-timeline-empty">Select a terminal to inspect its runtime, command, and activity.</p>
        </div>
      </aside>
    );
  }

  const kindMeta = tileKindMeta(sessionTileKind(session));
  const command = sessionCommandLabel(session) ?? "";
  const runtimeStatus = session.runtimeStatus ?? (session.runtimeId ? "live" : "starting");
  const displayStatus = terminalSessionDisplayStatus(session);
  const activityEvents = session.activityEvents ?? [];
  const presentedActivity = presentActivityEvents(activityEvents, { includeRaw: showRawActivity });
  const ageLabel = sessionAgeLabel(session.createdAt, ageClock);
  const activityDigest = activityDigestItems(activityEvents);
  const activitySummary = summarizeActivityEvents(activityEvents);
  const pulseCard = sessionPulseCard(session, displayStatus, activityEvents);
  const isolatedCheckout = isIsolatedCheckoutSession(session);
  const summaryCard = sessionSummaryCard(session, kindMeta.label, isolatedCheckout);
  const handoffActions = sessionHandoffActions(session, command);
  const worktreeLifecycleActions = isolatedCheckout ? isolatedCheckoutLifecycleActions() : [];
  const cwdFactLabel = session.cwd ? shortenWorktreeLabel(session.cwd) : "default workspace";
  const branchFactLabel = session.branchName ? shortenWorktreeLabel(session.branchName) : null;
  const baseFactLabel = session.baseCwd ? shortenWorktreeLabel(session.baseCwd) : null;
  const isolationFactLabel = isolatedCheckout ? "isolated worktree" : session.isolation === "shared" ? "shared workspace" : null;
  const canEditStagedSession = isEditableStagedSession(session) && Boolean(onUpdateStagedSession);
  const startEdit = () => {
    setEditDraft({
      args: argsToDraft(session.args),
      command: session.command ?? "",
      cwd: session.cwd,
    });
    setEditError(null);
    setEditMode(true);
  };
  const cancelEdit = () => {
    setEditDraft(emptyEditDraft());
    setEditError(null);
    setEditMode(false);
  };
  const submitEdit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!onUpdateStagedSession || !canEditStagedSession) return;
    const commandValue = editDraft.command.trim();
    if (!commandValue) {
      setEditError("Command is required.");
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      await onUpdateStagedSession(session.id, {
        command: commandValue,
        args: draftToArgs(editDraft.args),
        cwd: editDraft.cwd.trim(),
      });
      setEditMode(false);
    } catch (error: unknown) {
      setEditError(error instanceof Error ? error.message : "Could not save the edited command.");
    } finally {
      setEditSaving(false);
    }
  };
  const handleEditKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submitEdit();
    }
  };
  const handlePayloadAction = async (event: SessionActivityEvent, payload: ActivityPayloadView) => {
    const pendingLabel = payload.action === "reveal" ? "opening" : "copying";
    setPayloadActionState((current) => ({ ...current, [event.id]: pendingLabel }));
    try {
      if (payload.action === "reveal") {
        if (!onRevealActivityFile) {
          throw new Error("Reveal action is unavailable.");
        }
        await onRevealActivityFile(payload.value, session.cwd);
        setPayloadActionState((current) => ({ ...current, [event.id]: "revealed" }));
      } else {
        if (onCopyActivityText) {
          await onCopyActivityText(payload.value);
        } else {
          await navigator.clipboard?.writeText(payload.value);
        }
        setPayloadActionState((current) => ({ ...current, [event.id]: "copied" }));
      }
    } catch {
      setPayloadActionState((current) => ({ ...current, [event.id]: "missing" }));
    }

    window.setTimeout(() => {
      setPayloadActionState((current) => {
        const next = { ...current };
        delete next[event.id];
        return next;
      });
    }, 1600);
  };
  const handleSessionAction = async (action: SessionHandoffAction) => {
    const pendingLabel = action.kind === "copy" ? "copying" : "opening";
    const actionKey = sessionHandoffActionKey(session.id, action.id);
    setSessionActionState((current) => ({ ...current, [actionKey]: pendingLabel }));
    try {
      if (action.kind === "copy") {
        if (onCopyActivityText) {
          await onCopyActivityText(action.value);
        } else {
          await navigator.clipboard?.writeText(action.value);
        }
        setSessionActionState((current) => ({ ...current, [actionKey]: "copied" }));
      } else if (action.kind === "reveal-folder") {
        if (!onRevealActivityFile) {
          throw new Error("Reveal action is unavailable.");
        }
        await onRevealActivityFile(".", action.cwd);
        setSessionActionState((current) => ({ ...current, [actionKey]: "opened" }));
      } else if (action.kind === "open-terminal") {
        if (!onOpenExternalTerminal) {
          throw new Error("External terminal action is unavailable.");
        }
        await onOpenExternalTerminal(action.cwd);
        setSessionActionState((current) => ({ ...current, [actionKey]: "opened" }));
      }
    } catch {
      setSessionActionState((current) => ({ ...current, [actionKey]: "missing" }));
    }

    window.setTimeout(() => {
      setSessionActionState((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }, 1600);
  };
  const displayedEvents: SessionActivityEvent[] =
    activityEvents.length > 0
      ? presentedActivity.visibleEvents
      : [
          {
            id: `${session.id}-runtime-status`,
            kind: session.stage === "staged" ? "approval" : runtimeStatus === "error" ? "error" : "lifecycle",
            title: session.stage === "staged" ? "Queued by Alfred" : runtimeEventTitle(runtimeStatus),
            detail:
              session.stage === "staged"
                ? "Review the proposed command before it starts."
                : runtimeEventCopy(runtimeStatus),
            at: session.lastActivityAt ?? 0,
          },
        ];
  const visibleTimelineEvents = showRawActivity ? displayedEvents : displayedEvents.slice(0, TIMELINE_PREVIEW_LIMIT);
  const hiddenPreviewCount = Math.max(0, displayedEvents.length - visibleTimelineEvents.length);

  return (
    <aside className="agent-timeline-panel" aria-label="Agent activity">
      <header className="agent-timeline-header">
        <strong>{session.title}</strong>
        <span className={`agent-status-pill status-${displayStatus.kind}`}>
          <SessionStatusGlyph kind={displayStatus.kind} label={displayStatus.label} />
          <span className="agent-status-text">{displayStatus.label}</span>
        </span>
      </header>
      <div className="agent-timeline-body">
        {canEditStagedSession && !editMode && (
          <section className="agent-staged-editor" aria-label={`Edit staged command for ${session.title}`}>
            <div className="agent-staged-editor-copy">
              <span>review gate</span>
              <strong>{session.stagedReviewStatus === "edited" ? "Edited and rechecked" : "Adjust before launch"}</strong>
              <p>Command, arguments, and cwd can be corrected before Alfred releases this tile.</p>
            </div>
            <button type="button" onClick={startEdit}>
              Edit command
            </button>
          </section>
        )}
        {canEditStagedSession && editMode && (
          <form
            className="agent-staged-edit-form"
            aria-label={`Edit staged command for ${session.title}`}
            onSubmit={(event) => void submitEdit(event)}
            onKeyDown={handleEditKeyDown}
          >
            <div className="agent-staged-edit-heading">
              <span>command editor</span>
              <strong>Review launch details</strong>
              <p>Save runs the safety check again before the command can launch.</p>
            </div>
            <label>
              <span>Command</span>
              <input
                ref={commandInputRef}
                value={editDraft.command}
                onChange={(event) => setEditDraft((draft) => ({ ...draft, command: event.target.value }))}
              />
            </label>
            <label>
              <span>Arguments</span>
              <textarea
                value={editDraft.args}
                onChange={(event) => setEditDraft((draft) => ({ ...draft, args: event.target.value }))}
                rows={4}
              />
            </label>
            <label>
              <span>Working directory</span>
              <input
                value={editDraft.cwd}
                onChange={(event) => setEditDraft((draft) => ({ ...draft, cwd: event.target.value }))}
              />
            </label>
            {editError && <p role="alert">{editError}</p>}
            <div className="agent-staged-edit-actions">
              <button type="button" onClick={cancelEdit} disabled={editSaving}>
                Cancel
              </button>
              <button type="submit" disabled={editSaving || !editDraft.command.trim()}>
                {editSaving ? "Checking..." : "Save and re-check"}
              </button>
            </div>
          </form>
        )}
        <section className="agent-panel-section agent-session-summary" aria-label="Session summary">
          <div className="agent-section-heading">
            <span>summary</span>
            <strong>{summaryCard.title}</strong>
            {summaryCard.detail && <p>{summaryCard.detail}</p>}
          </div>
          <dl className="agent-session-facts" aria-label="session details">
            <div>
              <dt>kind</dt>
              <dd>{kindMeta.label}</dd>
            </div>
            <div>
              <dt>cwd</dt>
              <dd {...fullFactValueProps(session.cwd, cwdFactLabel)}>{cwdFactLabel}</dd>
            </div>
            {isolationFactLabel && (
              <div>
                <dt>isolation</dt>
                <dd>{isolationFactLabel}</dd>
              </div>
            )}
            {session.branchName && (
              <div>
                <dt>branch</dt>
                <dd {...fullFactValueProps(session.branchName, branchFactLabel ?? session.branchName)}>
                  {branchFactLabel}
                </dd>
              </div>
            )}
            {session.baseCwd && (
              <div>
                <dt>base</dt>
                <dd {...fullFactValueProps(session.baseCwd, baseFactLabel ?? session.baseCwd)}>{baseFactLabel}</dd>
              </div>
            )}
            {command && (
              <div>
                <dt>command</dt>
                <dd title={command} aria-label={command}>{command}</dd>
              </div>
            )}
            {ageLabel && (
              <div>
                <dt>age</dt>
                <dd title={sessionAgeTitle(session.createdAt)}>{ageLabel}</dd>
              </div>
            )}
            {activitySummary && (
              <div>
                <dt>activity</dt>
                <dd>{activitySummary}</dd>
              </div>
            )}
            {session.lastActivityAt && (
              <div>
                <dt>last activity</dt>
                <dd>{formatActivityTime(session.lastActivityAt)}</dd>
              </div>
            )}
            {session.lastOutputAt && (
              <div>
                <dt>last output</dt>
                <dd>{formatActivityTime(session.lastOutputAt)}</dd>
              </div>
            )}
          </dl>
          {activityDigest.length > 0 && (
            <section className="agent-activity-digest" aria-label="Activity digest">
              {activityDigest.map((item) => (
                <div className={`tone-${item.tone}`} key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{countedLabel(item.value, item.label)}</span>
                </div>
              ))}
            </section>
          )}
        </section>
        {handoffActions.length > 0 && (
          <section className="agent-panel-section agent-handoff-actions" aria-label={`Handoff actions for ${session.title}`}>
            <div className="agent-section-heading">
              <span>handoff</span>
              <strong>Continue outside Alfred</strong>
            </div>
            <div className="agent-handoff-buttons">
              {handoffActions.map((action) => (
                <HandoffActionButton
                  action={action}
                  actionState={sessionActionState[sessionHandoffActionKey(session.id, action.id)]}
                  key={action.id}
                  onAction={handleSessionAction}
                />
              ))}
            </div>
          </section>
        )}
        {worktreeLifecycleActions.length > 0 && (
          <section className="agent-panel-section agent-handoff-actions" aria-label={`Checkout lifecycle for ${session.title}`}>
            <div className="agent-section-heading">
              <span>checkout</span>
              <strong>Isolated checkout context</strong>
              <p className="agent-handoff-note">Use the checkout actions above to review or apply changes.</p>
            </div>
            <div className="agent-handoff-buttons">
              {worktreeLifecycleActions.map((action) => (
                <span key={action.id} className="agent-preview-chip">
                  {action.label}
                </span>
              ))}
            </div>
          </section>
        )}
        {pulseCard && (
          <section className="agent-panel-section agent-key-signal" aria-label="Session pulse">
            <div className="agent-section-heading">
              <span>signal</span>
              <strong>Key signal</strong>
            </div>
            <div className={`agent-session-pulse tone-${pulseCard.tone}`}>
              <span>{pulseCard.label}</span>
              <strong>{pulseCard.title}</strong>
              <p>{pulseCard.detail}</p>
              {pulseCard.at > 0 && (
                <time dateTime={new Date(pulseCard.at).toISOString()}>{formatActivityTime(pulseCard.at)}</time>
              )}
            </div>
          </section>
        )}
        <section className="agent-panel-section agent-timeline-section" aria-label="Activity timeline">
          <div className="agent-section-heading">
            <span>timeline</span>
            <strong>{timelinePreviewLabel(visibleTimelineEvents.length)}</strong>
            <p>
              {showRawActivity
                ? "Raw stream with debug activity included."
                : hiddenPreviewCount > 0
                  ? `${hiddenPreviewCount} older ${hiddenPreviewCount === 1 ? "event" : "events"} hidden; debug noise stays out.`
                  : "Important activity, with debug noise hidden."}
            </p>
          </div>
          {presentedActivity.hiddenRawCount > 0 && (
            <button
              type="button"
              className="agent-raw-toggle"
              onClick={() => setShowRawActivity(true)}
            >
              Show raw ({presentedActivity.hiddenRawCount})
            </button>
          )}
          {showRawActivity && presentedActivity.rawEvents.length > 0 && (
            <button
              type="button"
              className="agent-raw-toggle"
              onClick={() => setShowRawActivity(false)}
            >
              Hide raw
            </button>
          )}
          <ol className="agent-activity-list">
            {visibleTimelineEvents.map((event) => {
              const payload = activityPayloadView(event);
              return (
                <li className={event.kind} key={event.id}>
                  <span />
                  <div>
                    <b>{event.title}</b>
                    <p>{event.detail}</p>
                    {payload && (
                      <div className={`agent-activity-object type-${payload.type}`}>
                        <span>{payload.label}</span>
                        <code>{payload.value}</code>
                        <button
                          type="button"
                          onClick={() => void handlePayloadAction(event, payload)}
                          disabled={
                            payloadActionState[event.id] === "opening" || payloadActionState[event.id] === "copying"
                          }
                          aria-label={`${payload.actionLabel} ${payload.label}: ${payload.value}`}
                        >
                          {payloadActionState[event.id] ?? payload.actionLabel}
                        </button>
                      </div>
                    )}
                    {event.at > 0 && (
                      <time dateTime={new Date(event.at).toISOString()}>{formatActivityTime(event.at)}</time>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </aside>
  );
}

type ActivityDigestTone = "ask" | "issue" | "plan" | "work";
type SessionPulseTone = "ask" | "issue" | "recovery" | "signal" | "work";

type SessionHandoffAction =
  | {
      ariaLabel: string;
      id: "copy-cwd" | "copy-command";
      kind: "copy";
      label: string;
      value: string;
    }
  | {
      ariaLabel: string;
      cwd: string;
      id: "open-terminal" | "reveal-folder";
      kind: "open-terminal" | "reveal-folder";
      label: string;
    };

type ActivityPayloadView = {
  action: "copy" | "reveal";
  actionLabel: string;
  label: string;
  type: string;
  value: string;
};

type SessionPulseCard = {
  at: number;
  detail: string;
  label: string;
  title: string;
  tone: SessionPulseTone;
};

type SessionSummaryCard = {
  detail: string | null;
  title: string;
};

type IsolatedCheckoutLifecycleAction = {
  id: "review-diff" | "apply-to-project";
  label: string;
};

type StagedEditDraft = {
  args: string;
  command: string;
  cwd: string;
};

const TIMELINE_PREVIEW_LIMIT = 4;

function emptyEditDraft(): StagedEditDraft {
  return {
    args: "",
    command: "",
    cwd: "",
  };
}

function timelinePreviewLabel(count: number): string {
  if (count === 0) return "No preview events";
  if (count === 1) return "1-event preview";
  return `${count}-event preview`;
}

function isEditableStagedSession(session: SessionTile): boolean {
  return session.stage === "staged" && (session.agentKind === "shell" || session.agentKind === "dev-server");
}

function argsToDraft(args: string[] | undefined): string {
  return (args ?? []).join("\n");
}

function draftToArgs(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function HandoffActionButton({
  action,
  actionState,
  onAction,
}: {
  action: SessionHandoffAction;
  actionState: string | undefined;
  onAction: (action: SessionHandoffAction) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAction(action)}
      disabled={actionState === "opening" || actionState === "copying"}
      aria-label={action.ariaLabel}
    >
      {actionState ?? action.label}
    </button>
  );
}

function fullFactValueProps(value: string | undefined, displayValue: string): { title?: string; "aria-label"?: string } {
  if (!value || value === displayValue) return {};
  return { title: value, "aria-label": value };
}

function isIsolatedCheckoutSession(session: Pick<SessionTile, "isolation" | "branchName" | "baseCwd">): boolean {
  if (session.isolation === "shared") return false;
  return Boolean(session.branchName && session.baseCwd) || session.isolation === "worktree";
}

function isolatedCheckoutLifecycleActions(): IsolatedCheckoutLifecycleAction[] {
  return [
    { id: "review-diff", label: "Review diff" },
    { id: "apply-to-project", label: "Apply to project" },
  ];
}

function sessionHandoffActions(session: SessionTile, command: string): SessionHandoffAction[] {
  const actions: SessionHandoffAction[] = [];
  if (session.cwd) {
    actions.push({
      id: "reveal-folder",
      kind: "reveal-folder",
      label: "Reveal",
      ariaLabel: `Reveal folder for ${session.title}`,
      cwd: session.cwd,
    });
    actions.push({
      id: "open-terminal",
      kind: "open-terminal",
      label: "Open terminal",
      ariaLabel: `Open external terminal for ${session.title}`,
      cwd: session.cwd,
    });
    actions.push({
      id: "copy-cwd",
      kind: "copy",
      label: "Copy cwd",
      ariaLabel: `Copy cwd for ${session.title}`,
      value: session.cwd,
    });
  }

  if (command) {
    actions.push({
      id: "copy-command",
      kind: "copy",
      label: "Copy command",
      ariaLabel: `Copy command for ${session.title}`,
      value: command,
    });
  }

  return actions;
}

function sessionHandoffActionKey(sessionId: string, actionId: SessionHandoffAction["id"]): string {
  return `${sessionId}:${actionId}`;
}

function activityDigestItems(events: NonNullable<SessionTile["activityEvents"]>): Array<{
  label: string;
  tone: ActivityDigestTone;
  value: number;
}> {
  const items = [
    { label: "command", tone: "work" as const, value: events.filter((event) => event.kind === "command").length },
    { label: "file", tone: "work" as const, value: events.filter((event) => event.kind === "file").length },
    { label: "tool", tone: "work" as const, value: events.filter((event) => event.kind === "tool").length },
    { label: "plan", tone: "plan" as const, value: events.filter((event) => event.kind === "plan").length },
    { label: "ask", tone: "ask" as const, value: events.filter((event) => event.kind === "approval").length },
    { label: "issue", tone: "issue" as const, value: events.filter((event) => event.kind === "error" || event.kind === "warning").length },
  ];

  return items.filter((item) => item.value > 0);
}

function countedLabel(count: number, singular: string): string {
  if (count === 1) return singular;
  if (singular === "ask") return "asks";
  return `${singular}s`;
}

function activityPayloadView(
  event: NonNullable<SessionTile["activityEvents"]>[number],
): ActivityPayloadView | null {
  const payload = event.payload;
  if (!payload) return null;

  switch (payload.type) {
    case "command":
      return { action: "copy", actionLabel: "Copy", label: "command", type: "command", value: payload.command };
    case "file":
      return { action: "reveal", actionLabel: "Reveal", label: payload.operation, type: "file", value: payload.path };
    case "tool":
      return { action: "copy", actionLabel: "Copy", label: payload.name, type: "tool", value: payload.input };
    case "plan":
      return { action: "copy", actionLabel: "Copy", label: "plan", type: "plan", value: payload.summary };
    case "approval":
      return { action: "copy", actionLabel: "Copy", label: "approval", type: "approval", value: payload.prompt };
    case "error":
      return { action: "copy", actionLabel: "Copy", label: "error", type: "error", value: payload.message };
    case "warning":
      return { action: "copy", actionLabel: "Copy", label: "warning", type: "warning", value: payload.message };
    default:
      return null;
  }
}

function useSessionAgeClock(createdAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (createdAt === undefined) return;

    const intervalId = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [createdAt]);

  return now;
}

function formatActivityTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function summarizeActivityEvents(events: NonNullable<SessionTile["activityEvents"]>): string | null {
  if (events.length === 0) return null;

  const labels: Array<[NonNullable<SessionTile["activityEvents"]>[number]["kind"], string]> = [
    ["command", "command"],
    ["file", "file"],
    ["plan", "plan"],
    ["tool", "tool"],
    ["approval", "ask"],
    ["error", "error"],
    ["warning", "warning"],
    ["output", "signal"],
    ["lifecycle", "state"],
  ];

  return labels
    .map(([kind, label]) => {
      const count = events.filter((event) => event.kind === kind).length;
      if (count === 0) return null;
      return `${count} ${label}${count === 1 ? "" : "s"}`;
    })
    .filter((item): item is string => item !== null)
    .join(" · ");
}

function sessionPulseCard(
  session: SessionTile,
  displayStatus: ReturnType<typeof terminalSessionDisplayStatus>,
  events: NonNullable<SessionTile["activityEvents"]>,
): SessionPulseCard | null {
  if (session.stage === "staged" && session.safetyNote) {
    return {
      at: session.lastActivityAt ?? 0,
      detail: session.safetyNote,
      label: "review before launch",
      title: "Safety review required",
      tone: "issue",
    };
  }

  if (displayStatus.kind === "waiting") {
    const approval = latestEventOfKind(events, "approval");
    return {
      at: approval?.at ?? session.lastActivityAt ?? 0,
      detail: approval?.detail ?? "The session is waiting for your response.",
      label: "needs you",
      title: approval?.title ?? "Waiting for approval",
      tone: "ask",
    };
  }

  if (displayStatus.kind === "error") {
    const error = latestEventOfKind(events, "error");
    return {
      at: error?.at ?? session.lastActivityAt ?? 0,
      detail: error?.detail ?? "The session reported an error.",
      label: "check this",
      title: error?.title ?? "Error reported",
      tone: "issue",
    };
  }

  if (displayStatus.kind === "blocked") {
    return {
      at: session.lastActivityAt ?? 0,
      detail: session.safetyNote ?? "This staged command needs manual review before launch.",
      label: "blocked",
      title: "Safety review required",
      tone: "issue",
    };
  }

  if (displayStatus.kind === "staged") {
    return {
      at: session.lastActivityAt ?? 0,
      detail: sessionCommandLabel(session) ?? "Review the proposed session before launch.",
      label: "ready to launch",
      title: "Plan item staged",
      tone: "work",
    };
  }

  if (displayStatus.kind === "starting") {
    return {
      at: session.lastActivityAt ?? 0,
      detail: "Alfred is attaching the terminal runtime.",
      label: "starting",
      title: "Starting session",
      tone: "signal",
    };
  }

  if (displayStatus.kind === "restored") {
    const codingAgent = session.agentKind === "codex" ||
      session.agentKind === "claude" ||
      session.command === "codex" ||
      session.command === "claude";

    return {
      at: session.lastActivityAt ?? session.lastOutputAt ?? 0,
      detail: codingAgent
        ? "Saved scrollback is available. Resume continues the latest agent conversation in this workspace."
        : "Saved scrollback is available. Relaunch starts a fresh process in this tile.",
      label: "resume",
      title: "Transcript restored",
      tone: "recovery",
    };
  }

  if (displayStatus.kind === "done") {
    return {
      at: session.lastActivityAt ?? session.lastOutputAt ?? 0,
      detail: "The process ended; scrollback remains available in the tile.",
      label: "ended",
      title: "Process finished",
      tone: "recovery",
    };
  }

  const warning = latestEventOfKind(events, "warning");
  if (warning) {
    return {
      at: warning.at,
      detail: warning.detail,
      label: "review",
      title: warning.title,
      tone: "issue",
    };
  }

  const latestSignal = latestStructuredSignal(events);
  if (latestSignal) {
    return {
      at: latestSignal.at,
      detail: latestSignal.detail,
      label: latestSignal.kind === "output" ? "latest output" : "latest signal",
      title: latestSignal.title,
      tone: latestSignal.kind === "plan" ? "work" : "signal",
    };
  }

  return null;
}

function sessionSummaryCard(
  session: SessionTile,
  kindLabel: string,
  isolatedCheckout: boolean,
): SessionSummaryCard {
  if (session.stage === "staged") {
    return {
      title: `${kindLabel} staged plan`,
      detail: "Launch decisions stay in the review flow; this panel keeps the command context.",
    };
  }

  return {
    title: isolatedCheckout ? "Isolated checkout context" : `${kindLabel} session context`,
    detail: "Use the facts below for path and command context.",
  };
}

function sessionCommandLabel(session: SessionTile): string | null {
  if (!session.command) return null;
  return [session.command, ...(session.args ?? [])].map(shellQuoteToken).join(" ");
}

const SHELL_SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;

function shellQuoteToken(value: string): string {
  if (value.length === 0) return "''";
  if (SHELL_SAFE_TOKEN.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function latestEventOfKind(
  events: NonNullable<SessionTile["activityEvents"]>,
  kind: NonNullable<SessionTile["activityEvents"]>[number]["kind"],
): NonNullable<SessionTile["activityEvents"]>[number] | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === kind) return event;
  }

  return null;
}

function latestStructuredSignal(
  events: NonNullable<SessionTile["activityEvents"]>,
): NonNullable<SessionTile["activityEvents"]>[number] | null {
  return meaningfulSignalEvents(events).at(-1) ?? null;
}

function runtimeEventTitle(status: SessionTile["runtimeStatus"]): string {
  switch (status) {
    case "error":
      return "Start failed";
    case "exited":
      return "Process exited";
    case "live":
      return "Session attached";
    case "restored":
      return "Transcript restored";
    case "starting":
    default:
      return "Starting terminal";
  }
}

function runtimeEventCopy(status: SessionTile["runtimeStatus"]): string {
  switch (status) {
    case "error":
      return "The runtime could not create this terminal.";
    case "exited":
      return "The process has ended; scrollback remains available in the tile.";
    case "live":
      return "Terminal output is streaming in the workspace.";
    case "restored":
      return "This is the last saved scrollback. Start a new terminal to continue work.";
    case "starting":
    default:
      return "Alfred is attaching the runtime process.";
  }
}
