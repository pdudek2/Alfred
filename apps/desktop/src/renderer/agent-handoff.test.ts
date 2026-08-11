import { describe, expect, it } from "vitest";
import { buildAgentHandoffDetail, recentHandoffItems } from "./agent-handoff";
import type { AttentionProjection } from "./attention-projection";
import type { SessionActivityEvent, SessionTile } from "./session-state";

function session(overrides: Partial<SessionTile> = {}): SessionTile {
  return {
    id: "agent-1",
    title: "Codex · auth",
    workspaceId: "ALFRED",
    cwd: "/repo",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    ...overrides,
  };
}

function event(
  kind: SessionActivityEvent["kind"],
  title: string,
  detail: string,
  at: number,
): SessionActivityEvent {
  return { id: `${kind}-${at}`, kind, title, detail, at };
}

function attention(overrides: Partial<AttentionProjection> = {}): AttentionProjection {
  return {
    id: "ALFRED:agent-1",
    workspaceId: "ALFRED",
    workspaceLabel: "Alfred",
    sessionId: "agent-1",
    sessionTitle: "Codex · auth",
    kind: "agent-waiting",
    section: "needs-you",
    blocksAgent: true,
    rank: 1,
    attentionAt: 20,
    reason: "Choose cache scope",
    provenance: "inferred",
    action: { kind: "open-in-work" },
    ...overrides,
  };
}

describe("agent handoff projection", () => {
  it("uses the real decision and recent activity without inventing evidence", () => {
    const detail = buildAgentHandoffDetail(attention(), session({
      branchName: "auth-cache",
      activityEvents: [
        event("file", "Updated policy", "src/policy.ts", 10),
        event("approval", "Waiting", "Choose cache scope", 20),
      ],
    }));

    expect(detail.stateLabel).toBe("Needs you");
    expect(detail.stateTone).toBe("attention");
    expect(detail.outcome).toBe("Choose cache scope");
    expect(detail.decision).toBe("Choose cache scope");
    expect(detail.branchName).toBe("auth-cache");
    expect(detail.activity.map((item) => item.detail)).toContain("src/policy.ts");
    expect(JSON.stringify(detail)).not.toMatch(/tests passed|\+\d+|−\d+/i);
  });

  it("projects recovery from its real record and permits only a reviewable worktree", () => {
    const detail = buildAgentHandoffDetail(attention({
      kind: "recovery",
      section: "recovery",
      blocksAgent: false,
      rank: null,
      reason: "Saved agent session can be resumed.",
      action: { kind: "resume" },
    }), session({
      runtimeStatus: "restored",
      isolation: "worktree",
      branchName: "resume-auth",
      baseCwd: "/repo",
      activityEvents: [event("lifecycle", "Restored", "Transcript restored", 10)],
    }));

    expect(detail).toMatchObject({
      outcome: "Transcript restored",
      canReviewDiff: true,
      stateLabel: "Restored",
      stateTone: "ready",
    });
    expect(detail.decision).toBeUndefined();
  });

  it("does not carry a stale approval forward as a current decision", () => {
    const latestOutputAt = Date.now();
    const detail = buildAgentHandoffDetail(attention({
      kind: "recovery",
      section: "recovery",
      blocksAgent: false,
      rank: null,
      action: { kind: "relaunch", confirmation: "none" },
    }), session({
      lastOutputAt: latestOutputAt,
      activityEvents: [event("approval", "Waiting", "Old approval", 20)],
    }));

    expect(detail.stateLabel).toBe("Working");
    expect(detail.stateTone).toBe("working");
    expect(detail.decision).toBeUndefined();
  });

  it("falls back to the record reason when a session has no activity", () => {
    const detail = buildAgentHandoffDetail(attention({ reason: "Launch needs safety review." }), session({
      stage: "staged",
      safetyNote: "Launch needs safety review.",
    }));

    expect(detail.activity).toEqual([]);
    expect(detail.outcome).toBe("Launch needs safety review.");
    expect(detail.stateLabel).toBe("Blocked");
    expect(detail.stateTone).toBe("danger");
  });

  it("keeps only the five most recent recovery records", () => {
    const items = Array.from({ length: 6 }, (_, index) => attention({
      id: `ALFRED:recovery-${index}`,
      section: "recovery",
      kind: "recovery",
      blocksAgent: false,
      rank: null,
      attentionAt: index,
    })).concat(attention({ id: "ALFRED:waiting" }));

    expect(recentHandoffItems(items).map((item) => item.attentionAt)).toEqual([5, 4, 3, 2, 1]);
  });
});
