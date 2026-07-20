import { describe, expect, it } from "vitest";
import type { SessionTile } from "./session-state";
import { isFreeChatScope, isFreeChatSession, isNavigableLiveSession } from "./session-scope";

function session(overrides: Partial<SessionTile> = {}): SessionTile {
  return {
    id: "codex-live",
    title: "Codex · active work",
    workspaceId: "A",
    cwd: "/Users/patryk/Desktop/Alfred",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind: "codex",
    ...overrides,
  };
}

describe("session scope", () => {
  it("classifies a live Documents/Codex session as a Free Chat", () => {
    const freeChat = session({
      id: "free-chat",
      cwd: "/Users/patryk/Documents/Codex/idea",
    });

    expect(isNavigableLiveSession(freeChat)).toBe(true);
    expect(isFreeChatSession(freeChat)).toBe(true);
  });

  it("keeps a live project session outside the Free Chat scope", () => {
    const projectSession = session();

    expect(isNavigableLiveSession(projectSession)).toBe(true);
    expect(isFreeChatSession(projectSession)).toBe(false);
  });

  it.each(["restored", "exited", "error"] as const)(
    "does not expose %s sessions as navigable Free Chats",
    (runtimeStatus) => {
      const inactiveFreeChat = session({
        cwd: "/Users/patryk/Documents/Codex/idea",
        runtimeStatus,
      });

      expect(isNavigableLiveSession(inactiveFreeChat)).toBe(false);
      expect(isFreeChatSession(inactiveFreeChat)).toBe(false);
      expect(isFreeChatScope(inactiveFreeChat)).toBe(true);
    },
  );
});
