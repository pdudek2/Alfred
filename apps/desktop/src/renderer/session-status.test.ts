import { describe, expect, it } from "vitest";
import { terminalSessionDisplayStatus } from "./session-status";
import type { SessionTile } from "./session-state";

function liveSession(overrides: Partial<SessionTile> = {}): SessionTile {
  return {
    id: "manual-1",
    title: "Manual",
    workspaceId: "A",
    cwd: "/repo",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    ...overrides,
  };
}

describe("session-status", () => {
  it("shows recent terminal output as active and old output as idle", () => {
    expect(terminalSessionDisplayStatus(liveSession({ lastOutputAt: 1_000 }), "ready", 10_000)).toEqual({
      kind: "active",
      label: "active",
    });
    expect(terminalSessionDisplayStatus(liveSession({ lastOutputAt: 1_000 }), "ready", 30_000)).toEqual({
      kind: "idle",
      label: "idle",
    });
  });

  it("shows approval activity as waiting until a later event replaces it", () => {
    expect(
      terminalSessionDisplayStatus(
        liveSession({
          activityEvents: [
            {
              id: "a1",
              kind: "approval",
              title: "Waiting for approval",
              detail: "Do you want to proceed?",
              at: 1_000,
            },
          ],
        }),
        "ready",
        90_000,
      ),
    ).toEqual({ kind: "waiting", label: "waiting" });

    expect(
      terminalSessionDisplayStatus(
        liveSession({
          lastOutputAt: 2_000,
          activityEvents: [
            {
              id: "a1",
              kind: "approval",
              title: "Waiting for approval",
              detail: "Do you want to proceed?",
              at: 1_000,
            },
          ],
        }),
        "ready",
        3_000,
      ),
    ).toEqual({ kind: "active", label: "active" });
  });

  it("maps terminal lifecycle states to user-facing labels", () => {
    expect(terminalSessionDisplayStatus(liveSession({ runtimeStatus: "starting" }), "connecting")).toEqual({
      kind: "starting",
      label: "starting",
    });
    expect(terminalSessionDisplayStatus(liveSession({ runtimeStatus: "exited" }), "ready")).toEqual({
      kind: "done",
      label: "done",
    });
    expect(terminalSessionDisplayStatus(liveSession({ runtimeStatus: "error" }), "ready")).toEqual({
      kind: "error",
      label: "error",
    });
    expect(terminalSessionDisplayStatus(liveSession({ runtimeStatus: "restored" }), "restored")).toEqual({
      kind: "restored",
      label: "restored",
    });
  });

  it("keeps staged safety separate from live runtime state", () => {
    expect(terminalSessionDisplayStatus(liveSession({ stage: "staged", stagedReviewStatus: "checking" }))).toEqual({
      kind: "checking",
      label: "checking",
    });
    expect(terminalSessionDisplayStatus(liveSession({ stage: "staged", safetyNote: "rm -rf" }))).toEqual({
      kind: "blocked",
      label: "blocked",
    });
    expect(terminalSessionDisplayStatus(liveSession({ stage: "staged" }))).toEqual({
      kind: "staged",
      label: "ready",
    });
  });
});
