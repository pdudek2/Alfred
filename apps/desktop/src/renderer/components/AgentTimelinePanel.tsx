import { useEffect, useRef, useState, type ReactNode, type FormEvent, type KeyboardEvent } from "react";
import type { AlfredStagedSessionPatch } from "../../shared/alfred-ipc";
import { activitySentence, presentActivityEvents } from "../../shared/activity-presentation";
import type { SessionActivityEvent, SessionTile } from "../session-state";
import { sessionState } from "../session-status";
import { sessionAgeLabel } from "../session-time";
import { SessionStatusGlyph, type SessionStatusGlyphKind } from "./SessionStatusGlyph";
import { externalTerminalLabel } from "./WorkspaceActionsMenu";

export type AgentTimelinePanelProps = {
  onCopyActivityText?: (value: string) => Promise<void> | void;
  onOpenExternalTerminal?: (cwd: string) => Promise<void> | void;
  onRevealActivityFile?: (filePath: string, cwd: string) => Promise<void> | void;
  onUpdateStagedSession?: (sessionId: string, patch: AlfredStagedSessionPatch) => Promise<void>;
  session: SessionTile | null;
  /** The app's one session clock, shared with every other surface. */
  now: number;
  projectName?: string;
  changes?: ReactNode;
};

export function AgentTimelinePanel({
  onCopyActivityText,
  onOpenExternalTerminal,
  onRevealActivityFile,
  onUpdateStagedSession,
  session,
  now,
  projectName,
  changes,
}: AgentTimelinePanelProps) {
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

  // The column is not shown without a session to describe.
  if (!session) return null;

  const displayStatus = sessionState(session, "ready", now);
  const activityEvents = session.activityEvents ?? [];
  const presentedActivity = presentActivityEvents(activityEvents, {
    includeRaw: showRawActivity,
    limit: activityEvents.length,
  });
  const locationName = session.branchName || (isIsolatedCheckoutSession(session)
    ? session.cwd.replace(/\/+$/, "").split("/").at(-1) : null) || projectName || session.workspaceId;
  const handoffActions = sessionHandoffActions(session);
  const canEditStagedSession = isEditableStagedSession(session) && Boolean(onUpdateStagedSession);
  // Why a draft cannot launch, as its plan row says it.
  const blockLabel = session.launchPreflight?.status === "blocked" ? session.launchPreflight.label : undefined;
  const blockReason = session.launchPreflight?.status === "blocked" ? session.launchPreflight.reason : session.safetyNote;
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
  const visibleTimelineEvents = presentedActivity.visibleEvents;
  // The star marks only the approval the session waits on now; an answered one reads as done.
  const waitingApprovalId = displayStatus.kind === "needs-you" && displayStatus.reason === "approval"
    ? visibleTimelineEvents.find((event) => event.kind === "approval")?.id
    : undefined;

  return (
    <aside className="agent-timeline-panel" aria-label="Agent activity">
      {/* The breadcrumb names the session and its state; this names it only for assistive tech. */}
      <header className="agent-timeline-header visually-hidden">
        <strong>{session.title}</strong>
      </header>
      <div className="agent-timeline-body">
        {changes}
        {session.stage === "staged" && blockReason && !canEditStagedSession && <p className="details-empty">{blockReason}</p>}
        {canEditStagedSession && !editMode && (
          <section className="agent-staged-editor" aria-label={`Edit draft command for ${session.title}`}>
            <div className="agent-staged-editor-copy">
              <strong>{blockLabel ?? (session.stagedReviewStatus === "edited" ? "Edited and rechecked" : "Adjust before launch")}</strong>
              <p>{blockReason ?? "Command, arguments, and cwd can be corrected before Alfred releases this session."}</p>
            </div>
            <button type="button" onClick={startEdit}>
              Edit command
            </button>
          </section>
        )}
        {canEditStagedSession && editMode && (
          <form
            className="agent-staged-edit-form"
            aria-label={`Edit draft command for ${session.title}`}
            onSubmit={(event) => void submitEdit(event)}
            onKeyDown={handleEditKeyDown}
          >
            <div className="agent-staged-edit-heading">
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
        <section className="details-section" aria-label="Activity">
          <header className="details-section-heading"><h2>Activity</h2></header>
              {presentedActivity.hiddenRawCount > 0 && (
                <button type="button" className="agent-raw-toggle" onClick={() => setShowRawActivity(true)}>
                  Show raw ({presentedActivity.hiddenRawCount})
                </button>
              )}
              {showRawActivity && presentedActivity.rawEvents.length > 0 && (
                <button type="button" className="agent-raw-toggle" onClick={() => setShowRawActivity(false)}>
                  Hide raw
                </button>
              )}
              {visibleTimelineEvents.length === 0 && <p className="details-empty">No activity yet.</p>}
              <ol className="agent-activity-list">
                {visibleTimelineEvents.map((event) => {
                  const payload = activityPayloadView(event);
                  const glyph = activityGlyph(event, event.id === waitingApprovalId);
                  return (
                    <li className={event.kind} key={event.id}>
                      <span className="details-activity-glyph" aria-hidden="true">
                        <SessionStatusGlyph kind={glyph.kind} label={glyph.label} size={12} />
                      </span>
                      {payload ? (
                        <button className="details-activity-text" type="button"
                          title={payload.value}
                          aria-label={`${payload.actionLabel} ${payload.label}: ${payload.value}`}
                          disabled={payloadActionState[event.id] === "opening" || payloadActionState[event.id] === "copying"}
                          onClick={() => void handlePayloadAction(event, payload)}>
                          <span className="details-activity-sentence">{activitySentence(event)}</span>
                          {payloadActionState[event.id] && <span role="status"> · {payloadActionState[event.id]}</span>}
                        </button>
                      ) : (
                        <span className="details-activity-text" title={event.detail || undefined}>
                          <span className="details-activity-sentence">{activitySentence(event)}</span>
                        </span>
                      )}
                      {event.at > 0 && <time dateTime={new Date(event.at).toISOString()} title={formatActivityTime(event.at)}>
                        {now - event.at < 60_000 ? `${Math.max(0, Math.floor((now - event.at) / 1000))}s` : sessionAgeLabel(event.at, now)}
                      </time>}
                    </li>
                  );
                })}
              </ol>
        </section>
        <section className="details-section" aria-label="Location">
          <header className="details-section-heading"><h2>Location</h2></header>
          <p className="details-location-name">{locationName}</p>
          <p className="details-location-path" title={session.cwd}>{session.cwd || "Default project folder"}</p>
        {handoffActions.length > 0 && (
          <div
            className="details-location-actions"
            role="group"
            aria-label={`Session actions for ${session.title}`}
          >
            {handoffActions.map((action) => (
              <HandoffActionButton
                action={action}
                actionState={sessionActionState[sessionHandoffActionKey(session.id, action.id)]}
                key={action.id}
                onAction={handleSessionAction}
              />
            ))}
          </div>
        )}
        </section>
      </div>
    </aside>
  );
}

type SessionHandoffAction =
  | {
      ariaLabel: string;
      id: "copy-cwd";
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

type StagedEditDraft = {
  args: string;
  command: string;
  cwd: string;
};


function emptyEditDraft(): StagedEditDraft {
  return {
    args: "",
    command: "",
    cwd: "",
  };
}

function isEditableStagedSession(session: SessionTile): boolean {
  return session.stage === "staged";
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

function isIsolatedCheckoutSession(session: Pick<SessionTile, "isolation" | "branchName" | "baseCwd">): boolean {
  if (session.isolation === "shared") return false;
  return Boolean(session.branchName && session.baseCwd) || session.isolation === "worktree";
}

function sessionHandoffActions(session: SessionTile): SessionHandoffAction[] {
  if (!session.cwd) return [];
  const terminalLabel = externalTerminalLabel();
  return [
    { id: "open-terminal", kind: "open-terminal", label: terminalLabel, ariaLabel: `${terminalLabel} for ${session.title}`, cwd: session.cwd },
    { id: "reveal-folder", kind: "reveal-folder", label: "Show in Finder", ariaLabel: `Show in Finder for ${session.title}`, cwd: session.cwd },
    { id: "copy-cwd", kind: "copy", label: "Copy path", ariaLabel: `Copy path for ${session.title}`, value: session.cwd },
  ];
}

function sessionHandoffActionKey(sessionId: string, actionId: SessionHandoffAction["id"]): string {
  return `${sessionId}:${actionId}`;
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

/** The v4 glyph grammar for a past step: done, with the Needs you star only on the approval still waiting and a failed mark for errors. */
function activityGlyph(event: SessionActivityEvent, waitsOnIt: boolean): { kind: SessionStatusGlyphKind; label: string } {
  if (waitsOnIt) return { kind: "needs-you", label: "needs you" };
  if (event.kind === "error") return { kind: "failed", label: "failed" };
  if (event.kind === "warning") return { kind: "idle", label: "warning" };
  return { kind: "done", label: "done" };
}

function formatActivityTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}
