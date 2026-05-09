import { describe, expect, it } from "vitest";
import { workspaceSessionSummary } from "./workspace-session-summary";
import type { SessionTile } from "./session-state";

function session(id: string, overrides: Partial<SessionTile> = {}): SessionTile {
  return {
    id,
    title: id,
    workspaceId: "A",
    cwd: "/repo",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    ...overrides,
  };
}

describe("workspace-session-summary", () => {
  it("summarizes meaningful session states in product order", () => {
    const now = 30_000;

    expect(
      workspaceSessionSummary(
        [
          session("idle-1"),
          session("active-1", { lastOutputAt: 28_000 }),
          session("waiting-1", {
            activityEvents: [
              {
                id: "approval-1",
                kind: "approval",
                title: "Waiting for approval",
                detail: "Do you want to proceed?",
                at: 10_000,
              },
            ],
          }),
          session("error-1", { runtimeStatus: "error" }),
        ],
        now,
      ),
    ).toBe("1 error · 1 waiting · 1 active · 1 idle");
  });

  it("describes an empty workspace plainly", () => {
    expect(workspaceSessionSummary([])).toBe("empty");
  });
});
