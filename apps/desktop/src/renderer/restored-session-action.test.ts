import { describe, expect, it } from "vitest";
import { restoredSessionActionLabel, restoredSessionActionTitle } from "./restored-session-action";

const conversation = "6f1c2a4e-8b1d-4c3e-9f2a-0d5e7b8c9a10";

describe("restored session action", () => {
  it("offers this conversation when Alfred knows it, and the latest one when it does not", () => {
    const named = { agentKind: "claude" as const, command: "claude", resumeTarget: { agentKind: "claude" as const, sessionId: conversation, source: "agent-hook" as const } };
    const unnamed = { agentKind: "claude" as const, command: "claude" };

    expect(restoredSessionActionLabel(named, false, false)).toBe("Resume");
    expect(restoredSessionActionTitle(named)).toBe("Resume this session");
    expect(restoredSessionActionLabel(unnamed, false, false)).toBe("Resume latest");
    expect(restoredSessionActionTitle(unnamed)).toBe("Resume the latest Claude conversation for this project.");
  });
});
