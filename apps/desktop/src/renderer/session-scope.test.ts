import { describe, expect, it } from "vitest";
import type { SessionTile } from "./session-state";
import {
  isActiveAgentSession,
  isFreeChatPath,
  isFreeChatScope,
  isFreeChatSession,
  isNavigableLiveSession,
} from "./session-scope";

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

  it("does not treat a project whose name merely starts with Codex as a Free Chat", () => {
    expect(isFreeChatPath("/Users/patryk/Documents/CodexProject")).toBe(false);
    expect(isFreeChatPath("C:\\Users\\patryk\\Documents\\Codex\\idea")).toBe(true);
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

  it("counts only live Codex and Claude work as active agents", () => {
    const { agentKind: _detectedKind, ...detectedAgent } = session({ detectedAgentKind: "claude" });
    const { agentKind: _manualKind, ...manualSession } = session();
    expect(isActiveAgentSession(session())).toBe(true);
    expect(isActiveAgentSession(detectedAgent)).toBe(true);
    expect(isActiveAgentSession(session({ activityEvents: [
      { id: "approval", kind: "approval", title: "Waiting", detail: "Approve?", at: 10 },
    ] }))).toBe(false);
    expect(isActiveAgentSession(manualSession)).toBe(false);
    expect(isActiveAgentSession(session({ stage: "staged" }))).toBe(false);
    expect(isActiveAgentSession(session({ runtimeStatus: "exited" }))).toBe(false);
    expect(isActiveAgentSession(session({ runtimeStatus: "unavailable" }))).toBe(false);
    expect(isActiveAgentSession(session({ cwd: "/Users/patryk/Documents/Codex/idea" }))).toBe(false);
  });
});
