import { describe, expect, it } from "vitest";
import { nextApprovalRevealAt, sessionState } from "./session-status";
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
  it("gives an agent Alfred launched Your turn until you send it a message, whatever it draws first", () => {
    // Claude redraws its screen at start and after --continue; that is not work.
    for (const agentKind of ["claude", "codex"] as const) {
      expect(sessionState(liveSession({ agentKind, command: agentKind, lastOutputAt: 9_000 }), "ready", 10_000).kind)
        .toBe("your-turn");
    }
    // Launched with its first message, it works from the start.
    expect(sessionState(liveSession({ agentKind: "claude", command: "claude", args: ["--", "fix the build"], lastOutputAt: 9_000 }), "ready", 10_000).kind)
      .toBe("working");
    // Once you have sent one and no hook says otherwise, as with a Codex whose hooks you did not trust, output is work.
    expect(sessionState(liveSession({ agentKind: "codex", command: "codex", promptSubmitted: true, lastOutputAt: 9_000 }), "ready", 10_000).kind)
      .toBe("working");
    // An agent typed in a shell runs without hooks, so its output still counts.
    expect(sessionState(liveSession({ detectedAgentKind: "claude", lastOutputAt: 9_000 }), "ready", 10_000).kind).toBe("working");
  });

  it("splits recent output into Working for agents and Running for shells", () => {
    expect(sessionState(liveSession({ agentKind: "codex", promptSubmitted: true, lastOutputAt: 1_000 }), "ready", 10_000)).toEqual({
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
      sessionState(liveSession({ agentKind: "codex", promptSubmitted: true, lastOutputAt: 2_000, activityEvents: [approval] }), "ready", 3_000),
    ).toEqual({ kind: "working", label: "working" });
  });

  it("shows a Codex start screen as Needs you while it lasts, over what the session reports", () => {
    const codex = { agentKind: "codex" as const, command: "codex", lastOutputAt: 9_000 };
    const startScreen = { kind: "needs-you", label: "needs you", reason: "start-screen" };
    expect(sessionState(liveSession({ ...codex, startScreen: "hooks" }), "ready", 10_000)).toEqual(startScreen);
    // A worker launched with its message, after a key on the screen, or with a hook already reporting: it still waits.
    expect(sessionState(liveSession({ ...codex, args: ["--", "fix it"], startScreen: "sign-in" }), "ready", 10_000)).toEqual(startScreen);
    expect(sessionState(liveSession({ ...codex, promptSubmitted: true, startScreen: "folder" }), "ready", 10_000)).toEqual(startScreen);
    const working = { agentSignal: { state: "working" as const, source: "hook" as const, at: 9_000 } };
    expect(sessionState(liveSession({ ...codex, ...working, startScreen: "hooks" }), "ready", 10_000)).toEqual(startScreen);
    // Once the screen goes, the session's own signal counts again.
    expect(sessionState(liveSession({ ...codex, ...working }), "ready", 10_000).kind).toBe("working");
    expect(sessionState(liveSession({ ...codex, runtimeStatus: "exited", startScreen: "hooks" }), "ready", 10_000).kind).toBe("done");
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
    // The renderer and the main process each record the exit; neither answers the blocker.
    const exited: SessionActivityEvent = { id: "exit", kind: "lifecycle", title: "Process exited", detail: "Session ended", at: 1_500 };
    const failed: SessionActivityEvent = { id: "fail", kind: "error", title: "Process failed", detail: "Failed with exit code 1", at: 1_500 };
    expect(sessionState(liveSession({ runtimeStatus: "exited", activityEvents: [blocker, exited, exited] }), "ready", 2_000))
      .toEqual({ kind: "needs-you", label: "needs you", reason: "runtime-blocker" });
    expect(sessionState(liveSession({ runtimeStatus: "error", activityEvents: [blocker, exited, failed] }), "ready", 2_000))
      .toEqual({ kind: "needs-you", label: "needs you", reason: "runtime-blocker" });
    // Without a blocker the exit is Done or Failed, and resuming answers the blocker.
    const progress: SessionActivityEvent = { id: "progress", kind: "output", title: "Progress reported", detail: "Build complete", at: 1_000 };
    expect(sessionState(liveSession({ runtimeStatus: "exited", activityEvents: [progress, exited] }), "ready", 2_000).kind).toBe("done");
    expect(sessionState(liveSession({ runtimeStatus: "error", activityEvents: [progress, exited, failed] }), "ready", 2_000).kind)
      .toBe("failed");
    const resuming: SessionActivityEvent = { id: "resume", kind: "lifecycle", title: "Resuming session", detail: "", at: 1_800 };
    expect(sessionState(liveSession({ runtimeStatus: "starting", activityEvents: [blocker, exited, resuming] }), "connecting").kind)
      .toBe("running");
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

  it("reports when recent output stops hiding an approval prompt", () => {
    const approval = { id: "a", kind: "approval", title: "Approval", detail: "allow?", at: 1_000 } as SessionActivityEvent;
    // A trailing chunk stamped just after the prompt keeps the session busy for the output window.
    const waiting = liveSession({ activityEvents: [approval], lastOutputAt: 1_005 });
    expect(sessionState(waiting, "ready", 10_000).kind).toBe("running");
    expect(nextApprovalRevealAt([waiting], 10_000)).toBe(16_006);
    expect(sessionState(waiting, "ready", 16_005).kind).toBe("running");
    expect(sessionState(waiting, "ready", 16_006).kind).toBe("needs-you");
    expect(nextApprovalRevealAt([waiting], 16_006)).toBeNull();
    expect(nextApprovalRevealAt([liveSession({ lastOutputAt: 1_005 })], 10_000)).toBeNull();
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
