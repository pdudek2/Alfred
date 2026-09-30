import { describe, expect, it } from "vitest";
import { sessionState } from "./session-status";
import type { SessionActivityEvent, SessionTile } from "./session-state";

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

const approval: SessionActivityEvent = {
  id: "a1",
  kind: "approval",
  title: "Waiting for approval",
  detail: "Do you want to proceed?",
  at: 1_000,
};

const blocker: SessionActivityEvent = {
  id: "runtime-blocker",
  kind: "error",
  title: "Runtime blocked",
  detail: "Not logged in",
  payload: { type: "error", message: "Not logged in" },
  at: 1_000,
};

describe("sessionState", () => {
  it("splits recent output into Working for agents and Running for shells", () => {
    expect(sessionState(liveSession({ agentKind: "codex", lastOutputAt: 1_000 }), "ready", 10_000)).toEqual({
      kind: "working",
      label: "working",
    });
    expect(sessionState(liveSession({ agentKind: "shell", lastOutputAt: 1_000 }), "ready", 10_000)).toEqual({
      kind: "running",
      label: "running",
    });
  });

  it("gives a quiet agent Your turn and a quiet shell Idle", () => {
    expect(sessionState(liveSession({ agentKind: "claude", lastOutputAt: 1_000 }), "ready", 30_000)).toEqual({
      kind: "your-turn",
      label: "your turn",
    });
    expect(sessionState(liveSession({ lastOutputAt: 1_000 }), "ready", 30_000)).toEqual({ kind: "idle", label: "idle" });
  });

  it("treats a shell running a detected agent as an agent session", () => {
    expect(sessionState(liveSession({ detectedAgentKind: "claude", lastOutputAt: 1_000 }), "ready", 30_000).kind)
      .toBe("your-turn");
  });

  it("shows an approval as Needs you until later output replaces it", () => {
    expect(sessionState(liveSession({ agentKind: "codex", activityEvents: [approval] }), "ready", 90_000)).toEqual({
      kind: "needs-you",
      label: "needs you",
      reason: "approval",
    });
    expect(
      sessionState(liveSession({ agentKind: "codex", lastOutputAt: 2_000, activityEvents: [approval] }), "ready", 3_000),
    ).toEqual({ kind: "working", label: "working" });
  });

  it("keeps a runtime blocker as Needs you, even after its process ended, until later work arrives", () => {
    expect(sessionState(liveSession({ activityEvents: [blocker], lastOutputAt: 1_000 }), "ready", 2_000)).toEqual({
      kind: "needs-you",
      label: "needs you",
      reason: "runtime-blocker",
    });
    expect(
      sessionState(liveSession({ runtimeStatus: "exited", activityEvents: [blocker], lastOutputAt: 1_000 }), "ready", 2_000),
    ).toEqual({ kind: "needs-you", label: "needs you", reason: "runtime-blocker" });
    expect(
      sessionState(
        liveSession({
          activityEvents: [blocker, { id: "progress", kind: "output", title: "Progress reported", detail: "Build complete", at: 2_000 }],
          lastOutputAt: 2_000,
        }),
        "ready",
        3_000,
      ).kind,
    ).toBe("running");
  });

  it("maps lifecycle to Done, Failed and Asleep, and starting to the busy state", () => {
    expect(sessionState(liveSession({ runtimeStatus: "starting" }), "connecting").kind).toBe("running");
    expect(sessionState(liveSession({ agentKind: "codex", runtimeStatus: "starting" }), "connecting").kind).toBe("working");
    expect(sessionState(liveSession({ runtimeStatus: "exited" }))).toEqual({ kind: "done", label: "done" });
    expect(sessionState(liveSession({ runtimeStatus: "error" }))).toEqual({ kind: "failed", label: "failed" });
    expect(sessionState(liveSession({ runtimeStatus: "restored" }), "restored")).toEqual({ kind: "asleep", label: "asleep" });
    expect(sessionState(liveSession(), "browser")).toEqual({ kind: "unavailable", label: "unavailable" });
  });

  it("trusts what an agent reports about itself over output timing", () => {
    const claude = { agentKind: "claude" as const, lastOutputAt: 1_000 };
    const signal = (state: "working" | "needs-you" | "your-turn", at: number) => ({
      agentSignal: { state, source: "hook" as const, at },
    });
    expect(sessionState(liveSession({ ...claude, ...signal("needs-you", 900) }), "ready", 5_000)).toEqual({
      kind: "needs-you",
      label: "needs you",
      reason: "approval",
    });
    expect(sessionState(liveSession({ ...claude, ...signal("your-turn", 900) }), "ready", 2_000).kind).toBe("your-turn");
    expect(sessionState(liveSession({ ...claude, ...signal("working", 900) }), "ready", 40_000).kind).toBe("working");
    // An interrupted turn sends no Stop, so a stale "working" falls back to output timing.
    expect(sessionState(liveSession({ ...claude, ...signal("working", 900) }), "ready", 100_000).kind).toBe("your-turn");
  });

  it("uses the shell foreground instead of output timing for plain terminals", () => {
    expect(sessionState(liveSession({ shellBusy: true, lastOutputAt: 1_000 }), "ready", 100_000).kind).toBe("running");
    expect(sessionState(liveSession({ shellBusy: false, lastOutputAt: 99_000 }), "ready", 100_000).kind).toBe("idle");
  });

  it("shows plan items as Draft unless launch is blocked", () => {
    expect(sessionState(liveSession({ stage: "staged", stagedReviewStatus: "checking" }))).toEqual({
      kind: "draft",
      label: "draft",
    });
    expect(sessionState(liveSession({ stage: "staged" }))).toEqual({ kind: "draft", label: "draft" });
    expect(sessionState(liveSession({ stage: "staged", safetyNote: "rm -rf" }))).toEqual({
      kind: "needs-you",
      label: "needs you",
      reason: "blocked-launch",
    });
  });
});
