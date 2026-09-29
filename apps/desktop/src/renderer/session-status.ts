import type { SessionTile } from "./session-state";
import { runtimeBlockerReason } from "../shared/session-activity";

export type LocalTerminalStatus = "connecting" | "ready" | "browser" | "exited" | "error" | "restored";

/** The session states of the session model contract (§3), plus the dev-only browser state. */
export type SessionStateKind =
  | "needs-you"
  | "your-turn"
  | "working"
  | "running"
  | "idle"
  | "failed"
  | "done"
  | "draft"
  | "asleep"
  | "unavailable";

export type NeedsYouReason = "approval" | "blocked-launch" | "runtime-blocker";

export type SessionDisplayStatus =
  | { kind: "needs-you"; label: "needs you"; reason: NeedsYouReason }
  | { kind: Exclude<SessionStateKind, "needs-you">; label: string };

/** Contract priority: sorting and the project glyph use the first state that applies. */
export const SESSION_STATE_PRIORITY: readonly SessionStateKind[] = [
  "needs-you",
  "your-turn",
  "working",
  "running",
  "idle",
  "failed",
  "done",
  "draft",
  "asleep",
  "unavailable",
];

export const SESSION_STATE_LABELS: Record<SessionStateKind, string> = {
  "needs-you": "needs you",
  "your-turn": "your turn",
  working: "working",
  running: "running",
  idle: "idle",
  failed: "failed",
  done: "done",
  draft: "draft",
  asleep: "asleep",
  unavailable: "unavailable",
};

// ponytail: output window until the main process reports hooks, OSC 9 and the PTY foreground process.
const ACTIVE_OUTPUT_WINDOW_MS = 15_000;

function state(kind: Exclude<SessionStateKind, "needs-you">): SessionDisplayStatus {
  return { kind, label: SESSION_STATE_LABELS[kind] };
}

function needsYou(reason: NeedsYouReason): SessionDisplayStatus {
  return { kind: "needs-you", label: "needs you", reason };
}

/** Kind comes from the launch or the typed command, never from the PTY process name. */
export function isAgentSession(session: Pick<SessionTile, "agentKind" | "command" | "detectedAgentKind">): boolean {
  return session.detectedAgentKind !== undefined
    || session.agentKind === "codex" || session.agentKind === "claude"
    || session.command === "codex" || session.command === "claude";
}

export function sessionState(
  session: Pick<
    SessionTile,
    | "activityEvents"
    | "agentKind"
    | "command"
    | "detectedAgentKind"
    | "lastOutputAt"
    | "launchPreflight"
    | "runtimeStatus"
    | "safetyNote"
    | "stage"
    | "stagedReviewStatus"
  >,
  localStatus: LocalTerminalStatus = "ready",
  now = Date.now(),
): SessionDisplayStatus {
  if (session.stage === "staged") {
    if (session.stagedReviewStatus === "checking") return state("draft");
    return session.safetyNote || session.launchPreflight?.status === "blocked"
      ? needsYou("blocked-launch")
      : state("draft");
  }

  const latestEvent = session.activityEvents?.at(-1);
  if (latestEvent && runtimeBlockerReason(latestEvent)) return needsYou("runtime-blocker");

  if (localStatus === "browser" || session.runtimeStatus === "unavailable") return state("unavailable");
  if (localStatus === "error" || session.runtimeStatus === "error") return state("failed");
  if (localStatus === "exited" || session.runtimeStatus === "exited") return state("done");
  if (localStatus === "restored" || session.runtimeStatus === "restored") return state("asleep");

  const agent = isAgentSession(session);
  const busy = agent ? state("working") : state("running");
  if (localStatus === "connecting" || session.runtimeStatus === "starting") return busy;

  if (session.lastOutputAt !== undefined && now - session.lastOutputAt <= ACTIVE_OUTPUT_WINDOW_MS) {
    if (latestEvent?.kind !== "approval" || session.lastOutputAt > latestEvent.at) return busy;
  }

  if (latestEvent?.kind === "approval") return needsYou("approval");

  return agent ? state("your-turn") : state("idle");
}

/** Ended sessions and runtime blockers offer Restart; a blocker may outlive its process. */
export function isRestartable(status: SessionDisplayStatus): boolean {
  return status.kind === "done"
    || status.kind === "failed"
    || (status.kind === "needs-you" && status.reason === "runtime-blocker");
}
