import { describe, expect, it } from "vitest";
import type { ExternalSessionSummary, SessionsProjectInput } from "../shared/sessions-ipc";
import type { SessionTile } from "./session-state";
import { buildSessionsProjection } from "./sessions-projection";

const workspaces: SessionsProjectInput[] = [
  { id: "A", label: "Alfred", rootPath: "/Users/patryk/Desktop/Alfred" },
  { id: "FREE", label: "Free Chat", rootPath: "/Users/patryk/Documents/Codex" },
];

function managedSession(overrides: Partial<SessionTile> = {}): SessionTile {
  return {
    id: "managed-codex",
    title: "Codex · active work",
    workspaceId: "A",
    cwd: "/Users/patryk/Desktop/Alfred",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind: "codex",
    command: "codex",
    createdAt: 100,
    ...overrides,
  };
}

function externalSession(id: string, overrides: Partial<ExternalSessionSummary> = {}): ExternalSessionSummary {
  return {
    sessionKey: `external-codex:opaque-${id}`,
    lineageKey: `external-codex:${id}`,
    contentSessionKey: `external-codex:${id}`,
    source: "external-codex",
    kind: "codex",
    title: "External Codex conversation",
    project: { id: "A", label: "Alfred" },
    locationLabel: "Alfred",
    snippet: "A bounded external snippet",
    updatedAt: 80,
    lifecycle: "resumable",
    ...overrides,
  };
}

describe("buildSessionsProjection", () => {
  it("normalizes lifecycle state, groups Free Chats, and merges a resumed Codex lineage", () => {
    const externalId = "019fff00-1111-7222-8333-444444444444";
    const liveCodex = managedSession({
      resumeTarget: { agentKind: "codex", sessionId: externalId, source: "codex-session-index" },
      lastOutputAt: 300,
    });
    const restoredClaude = managedSession({
      id: "restored-claude",
      title: "Claude · saved work",
      agentKind: "claude",
      command: "claude",
      runtimeStatus: "restored",
      lastActivityAt: 200,
    });
    const exitedAgent = managedSession({
      id: "exited-manual",
      title: "Manual · done",
      runtimeStatus: "exited",
      lastActivityAt: 150,
    });
    const { agentKind: _agentKind, command: _command, ...exitedManual } = exitedAgent;
    const freeChat = managedSession({
      id: "free-chat",
      title: "Codex · scratch idea",
      workspaceId: "FREE",
      cwd: "/Users/patryk/Documents/Codex/idea",
      lastActivityAt: 250,
    });

    const projection = buildSessionsProjection({
      sessions: [liveCodex, restoredClaude, exitedManual, freeChat],
      workspaces,
      externalSessions: [externalSession(externalId)],
    });

    expect(projection.groups.find((group) => group.id === "free-chats")?.items).toHaveLength(1);
    expect(projection.items.filter((item) => item.lineageKey === `codex:${externalId}`)).toHaveLength(1);
    expect(projection.items.find((item) => item.lineageKey === `codex:${externalId}`)).toMatchObject({
      sessionKey: "managed:managed-codex",
      source: "managed",
      lifecycle: "live",
      contentSessionKey: `external-codex:${externalId}`,
    });
    expect(projection.items.find((item) => item.sessionKey === "managed:restored-claude")).toMatchObject({
      kind: "claude",
      lifecycle: "recoverable",
    });
    expect(projection.items.find((item) => item.sessionKey === "managed:exited-manual")).toMatchObject({
      kind: "manual",
      lifecycle: "read-only",
    });
    expect(projection.managedTargets.get("managed:managed-codex")).toEqual({
      workspaceId: "A",
      sessionId: "managed-codex",
    });
    expect(projection.managedTargets.get(`external-codex:opaque-${externalId}`)).toBeUndefined();
  });

  it("searches only display metadata and returns a bounded page with an independent total", () => {
    const sessions = Array.from({ length: 82 }, (_, index) => managedSession({
      id: `managed-${index}`,
      title: `Codex · issue ${index}`,
      branchName: index === 81 ? "needle-branch" : "main",
      createdAt: index,
    }));

    const firstPage = buildSessionsProjection({ sessions, workspaces, externalSessions: [] });
    const branchSearch = buildSessionsProjection({
      sessions,
      workspaces,
      externalSessions: [],
      query: "needle-branch",
    });
    const secondPage = buildSessionsProjection({
      sessions,
      workspaces,
      externalSessions: [],
      pageIndex: 1,
    });

    expect(firstPage.items).toHaveLength(80);
    expect(firstPage.total).toBe(82);
    expect(branchSearch.items).toHaveLength(1);
    expect(branchSearch.items[0]?.branch).toBe("needle-branch");
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.total).toBe(82);
  });

  it("keeps external transcript identity when the newest managed tile wins a duplicate lineage", () => {
    const externalId = "019fff00-5555-7222-8333-444444444444";
    const newest = managedSession({
      id: "managed-newest",
      lastActivityAt: 500,
      resumeTarget: { agentKind: "codex", sessionId: externalId, source: "codex-session-index" },
    });
    const older = managedSession({
      id: "managed-older",
      lastActivityAt: 100,
      resumeTarget: { agentKind: "codex", sessionId: externalId, source: "codex-session-index" },
    });

    const projection = buildSessionsProjection({
      sessions: [newest, older],
      workspaces,
      externalSessions: [externalSession(externalId)],
    });

    expect(projection.items).toMatchObject([{
      sessionKey: "managed:managed-newest",
      contentSessionKey: `external-codex:${externalId}`,
    }]);
    expect(projection.managedTargets.get("managed:managed-newest")).toEqual({
      workspaceId: "A",
      sessionId: "managed-newest",
    });
  });
});
