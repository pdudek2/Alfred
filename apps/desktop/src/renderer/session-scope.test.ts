import { describe, expect, it } from "vitest";
import type { SessionTile } from "./session-state";
import {
  deckAgentSessions,
  deckFocusSession,
  drawerSessions,
  isFreeChatPath,
  isFreeChatScope,
  isFreeChatSession,
  isNavigableLiveSession,
  isShellSession,
} from "./session-scope";

function session(overrides: Partial<SessionTile> = {}): SessionTile {
  return {
    id: "codex-live",
    title: "Codex · active work",
    workspaceId: "A",
    cwd: "/Users/sample/Desktop/Alfred",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind: "codex",
    ...overrides,
  };
}

function shell(overrides: Partial<SessionTile> = {}): SessionTile {
  const { agentKind: _agentKind, ...plain } = session(overrides);
  return plain;
}

describe("session scope", () => {
  it("splits a project's live sessions into deck agents and drawer shells", () => {
    const sessions = [
      session({ id: "codex-1" }),
      shell({ id: "manual-1" }),
      session({ id: "dev-1", agentKind: "dev-server", source: "alfred" }),
      shell({ id: "typed-1", detectedAgentKind: "claude" }),
      shell({ id: "ended-shell", runtimeStatus: "exited" }),
      session({ id: "ended-codex", runtimeStatus: "exited" }),
      shell({ id: "asleep-shell", runtimeStatus: "restored" }),
      session({ id: "draft-1", stage: "staged" }),
      shell({ id: "other-project-shell", workspaceId: "B" }),
    ];

    expect(deckAgentSessions(sessions, "A").map((item) => item.id)).toEqual(["codex-1", "typed-1", "ended-codex"]);
    expect(drawerSessions(sessions, "A").map((item) => item.id)).toEqual(["manual-1", "dev-1"]);
    expect(isShellSession(shell({ command: "claude" }))).toBe(false);
    // A shell selected last never becomes the focus, which picks among agents.
    expect(deckFocusSession(deckAgentSessions(sessions, "A"), "manual-1")?.id).toBe("codex-1");
  });

  it("classifies a live Documents/Codex session as a Free Chat", () => {
    const freeChat = session({
      id: "free-chat",
      cwd: "/Users/sample/Documents/Codex/idea",
    });

    expect(isNavigableLiveSession(freeChat)).toBe(true);
    expect(isFreeChatSession(freeChat)).toBe(true);
  });

  it("keeps a live project session outside the Free Chat scope", () => {
    const projectSession = session();

    expect(isNavigableLiveSession(projectSession)).toBe(true);
    expect(isFreeChatSession(projectSession)).toBe(false);
  });

  it("does not treat a project whose name merely starts with Codex as a Free Chat", () => {
    expect(isFreeChatPath("/Users/sample/Documents/CodexProject")).toBe(false);
    expect(isFreeChatPath("C:\\Users\\sample\\Documents\\Codex\\idea")).toBe(true);
  });

  it.each(["restored", "exited", "error"] as const)(
    "does not expose %s sessions as navigable Free Chats",
    (runtimeStatus) => {
      const inactiveFreeChat = session({
        cwd: "/Users/sample/Documents/Codex/idea",
        runtimeStatus,
      });

      expect(isNavigableLiveSession(inactiveFreeChat)).toBe(false);
      expect(isFreeChatSession(inactiveFreeChat)).toBe(false);
      expect(isFreeChatScope(inactiveFreeChat)).toBe(true);
    },
  );
});
