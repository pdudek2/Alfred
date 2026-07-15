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

  it("uses workspace label, session title, and stable id as deterministic timestamp fallbacks", () => {
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

  it("requires confirmation only for unsafe concrete recovery commands", () => {
    const items = buildAttentionProjection(
      workspaces,
      [
        session({
          id: "unsafe-relaunch",
          title: "Unsafe relaunch",
          runtimeStatus: "exited",
          command: "rm",
          args: ["-rf", "dist"],
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
});
