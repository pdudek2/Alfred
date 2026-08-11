import type { SessionTile } from "./session-state";
import { runtimeBlockerReason } from "../shared/session-activity";

export type LocalTerminalStatus = "connecting" | "ready" | "browser" | "exited" | "error" | "restored";

export type SessionDisplayStatus =
  | { kind: "active"; label: "working" }
  | { kind: "blocked"; label: "blocked" }
  | { kind: "done"; label: "done" }
  | { kind: "error"; label: "error" }
  | { kind: "idle"; label: "idle" }
  | { kind: "restored"; label: "restored" }
  | { kind: "runtime"; label: "unavailable" }
  | { kind: "staged"; label: "staged" }
  | { kind: "checking"; label: "checking" }
  | { kind: "starting"; label: "starting" }
  | { kind: "waiting"; label: "needs you" };

const ACTIVE_OUTPUT_WINDOW_MS = 15_000;

export function terminalSessionDisplayStatus(
  session: Pick<SessionTile, "activityEvents" | "lastOutputAt" | "launchPreflight" | "runtimeStatus" | "safetyNote" | "stage" | "stagedReviewStatus">,
  localStatus: LocalTerminalStatus = "ready",
  now = Date.now(),
): SessionDisplayStatus {
  if (session.stage === "staged") {
    if (session.stagedReviewStatus === "checking") {
      return { kind: "checking", label: "checking" };
    }
    return session.safetyNote || session.launchPreflight?.status === "blocked"
      ? { kind: "blocked", label: "blocked" }
      : { kind: "staged", label: "staged" };
  }

  if (localStatus === "browser" || session.runtimeStatus === "unavailable") return { kind: "runtime", label: "unavailable" };
  if (localStatus === "error" || session.runtimeStatus === "error") return { kind: "error", label: "error" };
  if (localStatus === "exited" || session.runtimeStatus === "exited") return { kind: "done", label: "done" };
  if (localStatus === "restored" || session.runtimeStatus === "restored") return { kind: "restored", label: "restored" };
  if (localStatus === "connecting" || session.runtimeStatus === "starting") return { kind: "starting", label: "starting" };

  const latestEvent = session.activityEvents?.at(-1);
  if (latestEvent && runtimeBlockerReason(latestEvent)) {
    return { kind: "error", label: "error" };
  }
  if (session.lastOutputAt !== undefined && now - session.lastOutputAt <= ACTIVE_OUTPUT_WINDOW_MS) {
    if (latestEvent?.kind !== "approval" || session.lastOutputAt > latestEvent.at) {
      return { kind: "active", label: "working" };
    }
  }

  if (latestEvent?.kind === "approval") {
    return { kind: "waiting", label: "needs you" };
  }

  return { kind: "idle", label: "idle" };
}
