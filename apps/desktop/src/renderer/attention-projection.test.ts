import { describe, expect, it } from "vitest";
import {
  blockingAttentionCount,
  blockingAttentionCountByWorkspace,
  buildAttentionProjection,
  type AttentionProjection,
} from "./attention-projection";
import type { SessionTile } from "./session-state";

const NOW = 10_000;

const workspaces = [
  { id: "ALFRED", label: "Alfred" },
  { id: "CLIENT", label: "Client" },
];

function session(overrides: Partial<SessionTile> & Pick<SessionTile, "id" | "title">): SessionTile {
  return {
    workspaceId: "ALFRED",
    cwd: "/repo",
    source: "manual",
    stage: "live",
    ...overrides,
  };
}

function projectionIds(items: AttentionProjection[]): string[] {
  return items.map((item) => item.sessionId);
}

describe("buildAttentionProjection", () => {
  it("projects an unresolved audited runtime blocker before approvals and never as Recovery", () => {
    const items = buildAttentionProjection(
      workspaces,
      [
        session({
          id: "runtime-blocker",
          title: "Claude authentication",
          runtimeStatus: "error",
          command: "claude",
          activityEvents: [{
            id: "auth",
            kind: "error",
            title: "Runtime blocked",
            detail: "Not logged in",
            payload: { type: "error", message: "Not logged in" },
            at: 100,
          }],
          lastOutputAt: 100,
        }),
        session({
          id: "waiting",
          title: "Waiting agent",
          activityEvents: [{ id: "approval", kind: "approval", title: "Waiting", detail: "Approve?", at: 50 }],
        }),
        session({
          id: "ordinary-error",
          title: "Compiler failure",
          activityEvents: [{ id: "compiler", kind: "error", title: "Error reported", detail: "tsc failed", at: 25 }],
        }),
      ],
      NOW,
    );

    expect(items.map(({ kind, sessionId, rank, blocksAgent }) => ({ kind, sessionId, rank, blocksAgent }))).toEqual([
      { kind: "runtime-blocker", sessionId: "runtime-blocker", rank: 0, blocksAgent: true },
      { kind: "agent-waiting", sessionId: "waiting", rank: 1, blocksAgent: true },
    ]);
    expect(items[0]).toMatchObject({
      section: "needs-you",
      reason: "Not logged in",
      provenance: "runtime",
      action: { kind: "open-in-work" },
    });
  });

  it("classifies the four approved attention kinds and derives blocking counts", () => {
    const items = buildAttentionProjection(
      workspaces,
      [
        session({
          id: "blocked",
          title: "Blocked deploy",
          source: "alfred",
          stage: "staged",
          command: "rm",
          args: ["-rf", "build"],
          safetyNote: "Destructive launch command",
          createdAt: 100,
        }),
        session({
          id: "waiting",
          title: "Waiting agent",
          workspaceId: "CLIENT",
          command: "codex",
          agentKind: "codex",
          activityEvents: [
            { id: "waiting-output", kind: "output", title: "Progress", detail: "Working", at: 150 },
            {
              id: "waiting-approval",
              kind: "approval",
              title: "Waiting for approval",
              detail: "Allow edit?",
              payload: { type: "approval", prompt: "Allow edit in app.tsx?" },
              at: 200,
            },
          ],
          lastActivityAt: 300,
          createdAt: 50,
        }),
        session({
          id: "staged",
          title: "Run tests",
          source: "alfred",
          stage: "staged",
          command: "pnpm",
          args: ["test"],
          createdAt: 300,
        }),
        session({
          id: "restored",
          title: "Saved Codex",
          workspaceId: "CLIENT",
          runtimeStatus: "restored",
          command: "codex",
          agentKind: "codex",
          resumeTarget: { agentKind: "codex", sessionId: "codex-session", source: "codex-session-index" },
          createdAt: 400,
        }),
      ],
      NOW,
    );

    expect(items.map(({ kind, rank, blocksAgent }) => ({ kind, rank, blocksAgent }))).toEqual([
      { kind: "blocked-safety", rank: 0, blocksAgent: true },
      { kind: "agent-waiting", rank: 1, blocksAgent: true },
      { kind: "staged-launch", rank: 2, blocksAgent: true },
      { kind: "recovery", rank: null, blocksAgent: false },
    ]);

    expect(items[0]).toMatchObject({
      id: "ALFRED:blocked",
      section: "needs-you",
      reason: "Destructive launch command",
      provenance: "runtime",
      command: "rm -rf build",
      action: { kind: "review-edit" },
    });
    expect(items[1]).toMatchObject({
      attentionAt: 200,
      reason: "Allow edit in app.tsx?",
      provenance: "inferred",
      action: { kind: "open-in-work" },
    });
    expect(items[2]).toMatchObject({
      reason: "pnpm test",
      provenance: "structured",
      action: { kind: "launch" },
    });
    expect(items[3]).toMatchObject({
      section: "recovery",
      blocksAgent: false,
      provenance: "runtime",
      action: { kind: "resume" },
    });

    expect(blockingAttentionCount(items)).toBe(3);
    expect(blockingAttentionCountByWorkspace(items)).toEqual(new Map([
      ["ALFRED", 2],
      ["CLIENT", 1],
    ]));
  });

  it("omits statuses and ended records that do not have a real attention action", () => {
    const items = buildAttentionProjection(
      workspaces,
      [
        session({
          id: "checking",
          title: "Checking command",
          source: "alfred",
          stage: "staged",
          stagedReviewStatus: "checking",
          command: "rm",
          safetyNote: "Still blocked until recheck finishes",
        }),
        session({
          id: "active",
          title: "Active agent",
          runtimeStatus: "live",
          lastOutputAt: NOW - 1,
        }),
        session({ id: "idle", title: "Idle shell", runtimeStatus: "live" }),
        session({ id: "runtime", title: "Unavailable runtime", runtimeStatus: "unavailable" }),
        session({ id: "restored-no-path", title: "Saved transcript", runtimeStatus: "restored" }),
        session({ id: "done-no-path", title: "Ended transcript", runtimeStatus: "exited" }),
        session({ id: "error-no-path", title: "Errored transcript", runtimeStatus: "error" }),
      ],
      NOW,
    );

    expect(items).toEqual([]);
  });

  it("emits at most one item per session using safety before waiting and launch", () => {
    const items = buildAttentionProjection(
      workspaces,
      [
        session({
          id: "multi-signal",
          title: "Multi signal",
          source: "alfred",
          stage: "staged",
          command: "rm",
          args: ["-rf", "dist"],
          safetyNote: "Review destructive command",
          activityEvents: [
            {
              id: "approval",
              kind: "approval",
              title: "Waiting",
              detail: "Approve launch?",
              at: 500,
            },
          ],
          runtimeStatus: "restored",
        }),
      ],
      NOW,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sessionId: "multi-signal",
      kind: "blocked-safety",
      action: { kind: "review-edit" },
    });
  });

  it("sorts older items first within the same rank", () => {
    const items = buildAttentionProjection(
      workspaces,
      [
        session({
          id: "newer",
          title: "Newer launch",
          source: "alfred",
          stage: "staged",
          command: "pnpm",
          args: ["build"],
          lastActivityAt: 200,
        }),
        session({
          id: "older",
          title: "Older launch",
          source: "alfred",
          stage: "staged",
          command: "pnpm",
          args: ["test"],
          lastActivityAt: 100,
        }),
      ],
      NOW,
    );

    expect(projectionIds(items)).toEqual(["older", "newer"]);
  });

  it("keeps missing staged timestamps at the canonical zero fallback and sorts them by stable identity", () => {
    const items = buildAttentionProjection(
      [
        { id: "B", label: "Beta" },
        { id: "A", label: "Alpha" },
      ],
      [
        session({ id: "beta", title: "Zed", workspaceId: "B", source: "alfred", stage: "staged", command: "one" }),
        session({ id: "z-id", title: "Zed", workspaceId: "A", source: "alfred", stage: "staged", command: "two" }),
        session({ id: "a-id", title: "Zed", workspaceId: "A", source: "alfred", stage: "staged", command: "three" }),
        session({ id: "alpha", title: "Alpha", workspaceId: "A", source: "alfred", stage: "staged", command: "four" }),
      ],
      NOW,
    );

    expect(items.every((item) => item.attentionAt === 0)).toBe(true);
    expect(projectionIds(items)).toEqual(["alpha", "a-id", "z-id", "beta"]);
  });

  it("emits one deterministic projection per stable id using attention precedence", () => {
    const lowerPrecedence = session({
      id: "duplicate",
      title: "Duplicate session",
      source: "alfred",
      stage: "staged",
      command: "pnpm",
      args: ["test"],
      createdAt: 100,
    });
    const higherPrecedence = session({
      id: "duplicate",
      title: "Duplicate session",
      source: "alfred",
      stage: "staged",
      command: "rm",
      args: ["-rf", "dist"],
      safetyNote: "Review destructive command",
      createdAt: 200,
    });

    const forward = buildAttentionProjection(workspaces, [lowerPrecedence, higherPrecedence], NOW);
    const reversed = buildAttentionProjection(workspaces, [higherPrecedence, lowerPrecedence], NOW);

    expect(forward).toHaveLength(1);
    expect(reversed).toEqual(forward);
    expect(forward[0]).toMatchObject({
      id: "ALFRED:duplicate",
      kind: "blocked-safety",
      reason: "Review destructive command",
      action: { kind: "review-edit" },
    });
  });

  it("requires confirmation only for untrusted concrete recovery commands", () => {
    const items = buildAttentionProjection(
      workspaces,
      [
        session({
          id: "unsafe-relaunch",
          title: "Unsafe relaunch",
          runtimeStatus: "exited",
          command: "/bin/sh",
          args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
        }),
        session({
          id: "safe-relaunch",
          title: "Safe relaunch",
          runtimeStatus: "error",
          command: "pnpm",
          args: ["test"],
        }),
      ],
      NOW,
    );

    expect(items.map(({ sessionId, action }) => ({ sessionId, action }))).toEqual([
      { sessionId: "safe-relaunch", action: { kind: "relaunch", confirmation: "none" } },
      { sessionId: "unsafe-relaunch", action: { kind: "relaunch", confirmation: "required" } },
    ]);
  });

  it("omits Recovery commands that the main process safety gate will always block", () => {
    const items = buildAttentionProjection(
      workspaces,
      [
        session({
          id: "hard-blocked-relaunch",
          title: "Destructive relaunch",
          runtimeStatus: "restored",
          command: "rm",
          args: ["-rf", "dist"],
        }),
        session({
          id: "confirmable-shell-relaunch",
          title: "Review shell relaunch",
          runtimeStatus: "restored",
          command: "/bin/sh",
          args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
        }),
      ],
      NOW,
    );

    expect(items.map(({ sessionId, action }) => ({ sessionId, action }))).toEqual([
      {
        sessionId: "confirmable-shell-relaunch",
        action: { kind: "relaunch", confirmation: "required" },
      },
    ]);
  });
});
