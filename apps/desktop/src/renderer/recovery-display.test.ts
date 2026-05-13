import { describe, expect, it } from "vitest";
import type { SessionTile } from "./session-state";
import { recoveryHeadline, recoverySummary } from "./recovery-display";

const baseSession = {
  id: "session",
  title: "Session",
  workspaceId: "A",
  cwd: "/repo",
  source: "manual",
  stage: "live",
} satisfies Partial<SessionTile>;

describe("recovery-display", () => {
  it("keeps saved transcript copy separate from ended and failed sessions", () => {
    const sessions = [
      { ...baseSession, id: "saved", runtimeStatus: "restored" },
      { ...baseSession, id: "ended", runtimeStatus: "exited" },
      { ...baseSession, id: "failed", runtimeStatus: "error" },
    ] as SessionTile[];

    expect(recoveryHeadline(sessions)).toBe("3 recovery items ready");
    expect(recoverySummary(sessions)).toBe("1 saved · 1 ended · 1 failed");
  });

  it("uses saved session copy only for restored transcripts", () => {
    expect(recoveryHeadline([
      { ...baseSession, id: "saved-1", runtimeStatus: "restored" },
      { ...baseSession, id: "saved-2", runtimeStatus: "restored" },
    ] as SessionTile[])).toBe("2 saved sessions ready");
  });
});
