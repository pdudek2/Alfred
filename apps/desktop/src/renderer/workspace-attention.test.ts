import { describe, expect, it } from "vitest";
import type { SessionTile } from "./session-state";
import { workspaceReviewQueue } from "./workspace-attention";

const baseSession = {
  workspaceId: "A",
  cwd: "/repo",
  source: "manual",
  stage: "live",
} satisfies Partial<SessionTile>;

describe("workspaceReviewQueue", () => {
  it("builds a prioritized review queue across workspaces", () => {
    const queue = workspaceReviewQueue(
      [
        { id: "A", label: "Alfred", shortLabel: "A" },
        { id: "W2", label: "ClientApp", shortLabel: "CLI" },
      ],
      [
        {
          ...baseSession,
          id: "idle",
          title: "Idle shell",
          runtimeStatus: "live",
        },
        {
          ...baseSession,
          id: "staged",
          title: "Ready task",
          source: "alfred",
          stage: "staged",
        },
        {
          ...baseSession,
          id: "waiting",
          title: "Waiting client agent",
          workspaceId: "W2",
          activityEvents: [{ id: "ask-1", kind: "approval", title: "Waiting", detail: "approve?", at: 100 }],
          lastActivityAt: 100,
        },
        {
          ...baseSession,
          id: "error",
          title: "Broken client agent",
          workspaceId: "W2",
          runtimeStatus: "error",
          lastActivityAt: 50,
        },
      ] as SessionTile[],
      200,
    );

    expect(queue.map((item) => item.session.id)).toEqual(["error", "waiting", "staged"]);
    expect(queue[0]).toMatchObject({
      workspaceId: "W2",
      workspaceLabel: "ClientApp",
      status: { kind: "error", label: "error" },
    });
  });

  it("uses structured activity as the review reason", () => {
    const queue = workspaceReviewQueue(
      [{ id: "A", label: "Alfred", shortLabel: "A" }],
      [
        {
          ...baseSession,
          id: "waiting",
          title: "Waiting agent",
          activityEvents: [
            {
              id: "ask-1",
              kind: "approval",
              title: "Waiting for approval",
              detail: "Allow edit?",
              at: 100,
              payload: { type: "approval", prompt: "Allow edit in app.tsx?" },
            },
          ],
        },
        {
          ...baseSession,
          id: "staged",
          title: "Queued work",
          source: "alfred",
          stage: "staged",
          command: "pnpm",
          args: ["test"],
        },
      ] as SessionTile[],
      200,
    );

    expect(queue[0]?.detail).toBe("Allow edit in app.tsx?");
    expect(queue[1]?.detail).toBe("pnpm test");
  });

  it("includes ended sessions as low-priority restartable review items", () => {
    const queue = workspaceReviewQueue(
      [
        { id: "A", label: "Alfred", shortLabel: "A" },
        { id: "W2", label: "ClientApp", shortLabel: "CLI" },
      ],
      [
        {
          ...baseSession,
          id: "restored",
          title: "Saved shell",
          runtimeStatus: "restored",
        },
        {
          ...baseSession,
          id: "ended",
          title: "Ended shell",
          workspaceId: "W2",
          runtimeStatus: "exited",
        },
      ] as SessionTile[],
      200,
    );

    expect(queue.map((item) => [item.session.id, item.status.kind, item.detail])).toEqual([
      ["restored", "restored", "can be relaunched"],
      ["ended", "done", "can be restarted"],
    ]);
    expect(queue[1]).toMatchObject({
      workspaceId: "W2",
      workspaceLabel: "ClientApp",
      workspaceShortLabel: "CLI",
    });
  });

  it("keeps review queue ordering deterministic when priority and activity time match", () => {
    const queue = workspaceReviewQueue(
      [
        { id: "B", label: "Beta", shortLabel: "B" },
        { id: "A", label: "Alpha", shortLabel: "A" },
      ],
      [
        {
          ...baseSession,
          id: "beta-zed",
          workspaceId: "B",
          title: "Zed task",
          source: "alfred",
          stage: "staged",
          lastActivityAt: 100,
        },
        {
          ...baseSession,
          id: "alpha-zed",
          workspaceId: "A",
          title: "Zed task",
          source: "alfred",
          stage: "staged",
          lastActivityAt: 100,
        },
        {
          ...baseSession,
          id: "alpha-alpha",
          workspaceId: "A",
          title: "Alpha task",
          source: "alfred",
          stage: "staged",
          lastActivityAt: 100,
        },
      ] as SessionTile[],
      200,
    );

    expect(queue.map((item) => `${item.workspaceLabel}:${item.session.title}`)).toEqual([
      "Alpha:Alpha task",
      "Alpha:Zed task",
      "Beta:Zed task",
    ]);
  });
});
