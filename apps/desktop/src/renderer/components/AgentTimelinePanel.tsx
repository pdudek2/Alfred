import { useEffect, useState } from "react";
import type { SessionTile } from "../session-state";
import { terminalSessionDisplayStatus } from "../session-status";
import { sessionAgeLabel, sessionAgeTitle } from "../session-time";
import { sessionTileKind, tileKindMeta } from "../tile-kind";

type AgentTimelinePanelProps = {
  onSendInput?: (runtimeId: string, data: string) => void;
  session: SessionTile | null;
};

export function AgentTimelinePanel({ onSendInput, session }: AgentTimelinePanelProps) {
  const ageClock = useSessionAgeClock(session?.createdAt);

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
  const command = [session.command, ...(session.args ?? [])].filter(Boolean).join(" ");
  const runtimeStatus = session.runtimeStatus ?? (session.runtimeId ? "live" : "starting");
  const displayStatus = terminalSessionDisplayStatus(session);
  const activityEvents = session.activityEvents ?? [];
  const ageLabel = sessionAgeLabel(session.createdAt, ageClock);
  const activityDigest = activityDigestItems(activityEvents);
  const activitySummary = summarizeActivityEvents(activityEvents);
  const latestApproval = latestApprovalEvent(activityEvents);
  const pulseCard = sessionPulseCard(session, displayStatus, activityEvents);
  const canSendApprovalResponse =
    Boolean(onSendInput) &&
    Boolean(session.runtimeId) &&
    session.stage === "live" &&
    session.runtimeStatus !== "exited" &&
    session.runtimeStatus !== "error" &&
    session.runtimeStatus !== "restored";
  const sendApprovalResponse = (data: string) => {
    if (!session.runtimeId || !onSendInput) return;
    onSendInput(session.runtimeId, data);
  };
  const displayedEvents =
    activityEvents.length > 0
      ? [...activityEvents].sort((a, b) => b.at - a.at)
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

  return (
    <aside className="agent-timeline-panel" aria-label="Agent activity">
      <header className="agent-timeline-header">
        <strong>{session.title}</strong>
        <span className={`agent-status-pill status-${displayStatus.kind}`}>{displayStatus.label}</span>
      </header>
      <div className="agent-timeline-body">
        <dl className="agent-session-facts" aria-label="session details">
          <div>
            <dt>kind</dt>
            <dd>{kindMeta.label}</dd>
          </div>
          <div>
            <dt>cwd</dt>
            <dd>{session.cwd || "default workspace"}</dd>
          </div>
          {command && (
            <div>
              <dt>command</dt>
              <dd>{command}</dd>
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
        {pulseCard && (
          <section className={`agent-session-pulse tone-${pulseCard.tone}`} aria-label="Session pulse">
            <span>{pulseCard.label}</span>
            <strong>{pulseCard.title}</strong>
            <p>{pulseCard.detail}</p>
            {pulseCard.at > 0 && (
              <time dateTime={new Date(pulseCard.at).toISOString()}>{formatActivityTime(pulseCard.at)}</time>
            )}
          </section>
        )}
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
        {latestApproval && canSendApprovalResponse && session.runtimeId && (
          <div className="agent-approval-actions" role="group" aria-label={`Approval actions for ${session.title}`}>
            <div>
              <span>approval</span>
              <strong>{latestApproval.title}</strong>
            </div>
            <button type="button" onClick={() => sendApprovalResponse("y\n")}>
              Send yes
            </button>
            <button type="button" onClick={() => sendApprovalResponse("n\n")}>
              Send no
            </button>
          </div>
        )}
        <ol className="agent-activity-list">
          {displayedEvents.map((event) => (
            <li className={event.kind} key={event.id}>
              <span />
              <div>
                <b>{event.title}</b>
                <p>{event.detail}</p>
                {event.at > 0 && <time dateTime={new Date(event.at).toISOString()}>{formatActivityTime(event.at)}</time>}
              </div>
            </li>
          ))}
          {session.safetyNote && (
            <li className="warning">
              <span />
              <div>
                <b>Safety review required</b>
                <p>{session.safetyNote}</p>
              </div>
            </li>
          )}
        </ol>
      </div>
    </aside>
  );
}

type ActivityDigestTone = "ask" | "issue" | "plan" | "work";
type SessionPulseTone = "ask" | "issue" | "recovery" | "signal" | "work";

type SessionPulseCard = {
  at: number;
  detail: string;
  label: string;
  title: string;
  tone: SessionPulseTone;
};

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

function latestApprovalEvent(events: NonNullable<SessionTile["activityEvents"]>): NonNullable<SessionTile["activityEvents"]>[number] | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === "approval") return event;
  }

  return null;
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
      title: "Safety check required",
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
      title: "Manual review required",
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
    return {
      at: session.lastActivityAt ?? session.lastOutputAt ?? 0,
      detail: "Saved scrollback is available. Relaunch starts a fresh process in this tile.",
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
      label: "latest signal",
      title: latestSignal.title,
      tone: latestSignal.kind === "plan" ? "work" : "signal",
    };
  }

  const latestOutput = latestEventOfKind(events, "output");
  if (latestOutput) {
    return {
      at: latestOutput.at,
      detail: latestOutput.detail,
      label: "latest output",
      title: latestOutput.title,
      tone: "signal",
    };
  }

  return null;
}

function sessionCommandLabel(session: SessionTile): string | null {
  const command = [session.command, ...(session.args ?? [])].filter(Boolean).join(" ");
  return command || null;
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
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.kind === "lifecycle" || event.kind === "output") continue;
    return event;
  }

  return null;
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
