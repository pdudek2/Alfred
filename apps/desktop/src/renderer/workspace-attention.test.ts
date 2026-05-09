import { describe, expect, it } from "vitest";
import type { SessionTile } from "./session-state";
import { workspaceAttention, workspaceReviewQueue } from "./workspace-attention";

const baseSession = {
  workspaceId: "A",
  cwd: "/repo",
  source: "manual",
  stage: "live",
} satisfies Partial<SessionTile>;

describe("workspaceAttention", () => {
  it("prioritizes errors before approvals and staged work", () => {
    const attention = workspaceAttention([
      {
        ...baseSession,
        id: "waiting",
        title: "Waiting agent",
        activityEvents: [{ id: "ask-1", kind: "approval", title: "Waiting", detail: "approve?", at: 100 }],
      },
      {
        ...baseSession,
        id: "error",
        title: "Broken agent",
        runtimeStatus: "error",
      },
      {
        ...baseSession,
        id: "staged",
        title: "Queued work",
        source: "alfred",
        stage: "staged",
      },
    ] as SessionTile[], 200);

    expect(attention?.session.id).toBe("error");
    expect(attention?.status.kind).toBe("error");
  });

  it("returns null when no session needs attention", () => {
    expect(
      workspaceAttention([
        {
          ...baseSession,
          id: "idle",
          title: "Idle shell",
          runtimeStatus: "live",
        },
      ] as SessionTile[]),
    ).toBeNull();
  });

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
});
