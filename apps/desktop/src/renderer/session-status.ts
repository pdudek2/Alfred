import type { SessionTile } from "./session-state";

export type LocalTerminalStatus = "connecting" | "ready" | "browser" | "exited" | "error" | "restored";

export type SessionDisplayStatus =
  | { kind: "active"; label: "active" }
  | { kind: "blocked"; label: "blocked" }
  | { kind: "done"; label: "done" }
  | { kind: "error"; label: "error" }
  | { kind: "idle"; label: "idle" }
  | { kind: "restored"; label: "restored" }
  | { kind: "runtime"; label: "electron only" }
  | { kind: "staged"; label: "ready" }
  | { kind: "starting"; label: "starting" }
  | { kind: "waiting"; label: "waiting" };

const ACTIVE_OUTPUT_WINDOW_MS = 15_000;

export function terminalSessionDisplayStatus(
  session: Pick<SessionTile, "activityEvents" | "lastOutputAt" | "launchPreflight" | "runtimeStatus" | "safetyNote" | "stage">,
  localStatus: LocalTerminalStatus = "ready",
  now = Date.now(),
): SessionDisplayStatus {
  if (session.stage === "staged") {
    return session.safetyNote || session.launchPreflight?.status === "blocked"
      ? { kind: "blocked", label: "blocked" }
      : { kind: "staged", label: "ready" };
  }

  if (localStatus === "browser") return { kind: "runtime", label: "electron only" };
  if (localStatus === "error" || session.runtimeStatus === "error") return { kind: "error", label: "error" };
  if (localStatus === "exited" || session.runtimeStatus === "exited") return { kind: "done", label: "done" };
  if (localStatus === "restored" || session.runtimeStatus === "restored") return { kind: "restored", label: "restored" };
  if (localStatus === "connecting" || session.runtimeStatus === "starting") return { kind: "starting", label: "starting" };

  const latestEvent = session.activityEvents?.at(-1);
  if (session.lastOutputAt !== undefined && now - session.lastOutputAt <= ACTIVE_OUTPUT_WINDOW_MS) {
    if (latestEvent?.kind !== "approval" || session.lastOutputAt > latestEvent.at) {
      return { kind: "active", label: "active" };
    }
  }

  if (latestEvent?.kind === "approval") {
    return { kind: "waiting", label: "waiting" };
  }

  return { kind: "idle", label: "idle" };
}
