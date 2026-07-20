import { describe, expect, it } from "vitest";
import type { ExternalSessionSummary, SessionSummary, SessionsProjectInput } from "../shared/sessions-ipc";
import type { SessionTile } from "./session-state";
import { buildSessionsProjection, sessionsPrimaryAction } from "./sessions-projection";

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

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionKey: "managed:summary",
    lineageKey: "managed:summary",
    contentSessionKey: null,
    source: "managed",
    kind: "codex",
    title: "Summary",
    project: { id: "A", label: "Alfred" },
    locationLabel: "Alfred",
    updatedAt: 100,
    lifecycle: "live",
    ...overrides,
  };
}

describe("sessionsPrimaryAction", () => {
  it("maps lifecycle and project trust to truthful primary actions", () => {
    const live = summary();
    const restored = summary({ lifecycle: "recoverable" });
    const mappedExternal = summary({
      sessionKey: "external:opaque-resume",
      source: "external-codex",
      lifecycle: "resumable",
    });
    const untrustedExternal = summary({
      sessionKey: "external:opaque-untrusted",
      source: "external-codex",
      project: { id: null, label: "External Codex" },
      lifecycle: "read-only",
    });
    const endedMapped = summary({
      sessionKey: "external:opaque-ended",
      source: "external-codex",
      lifecycle: "read-only",
    });
    const readOnlyUnknown = summary({
      project: { id: null, label: "Unknown" },
      lifecycle: "read-only",
    });

    expect(sessionsPrimaryAction(live)).toEqual({ kind: "reveal", label: "Reveal in Work" });
    expect(sessionsPrimaryAction(restored)).toMatchObject({ kind: "recover", label: "Resume in Work" });
    expect(sessionsPrimaryAction(mappedExternal)).toEqual({ kind: "resume-external", label: "Resume in Work" });
    expect(sessionsPrimaryAction(untrustedExternal)).toEqual({ kind: "add-project", label: "Add Project…" });
    expect(sessionsPrimaryAction(endedMapped)).toEqual({ kind: "open-project", label: "Open Project" });
    expect(sessionsPrimaryAction(readOnlyUnknown)).toBeNull();
  });
});

describe("buildSessionsProjection", () => {
  it("normalizes lifecycle state, identifies Free Chats, and merges a resumed Codex lineage", () => {
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
    const restoredFreeChat = managedSession({
      id: "restored-free-chat",
      title: "Codex · saved scratch idea",
      workspaceId: "FREE",
      cwd: "/Users/patryk/Documents/Codex/saved-idea",
      runtimeStatus: "restored",
      lastActivityAt: 240,
    });

    const projection = buildSessionsProjection({
      sessions: [liveCodex, restoredClaude, exitedManual, freeChat, restoredFreeChat],
      workspaces,
      externalSessions: [externalSession(externalId)],
    });

    expect(projection.projectCounts["free-chats"]).toBe(2);
    expect(projection.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: "managed:free-chat" }),
      expect.objectContaining({ sessionKey: "managed:restored-free-chat", lifecycle: "recoverable" }),
    ]));
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

  it("scopes conversations by project before search and paging while keeping stable project counts", () => {
    const projectB = managedSession({
      id: "client-session",
      workspaceId: "B",
      cwd: "/Users/patryk/Desktop/ClientApp",
      title: "Client release",
    });
    const allWorkspaces = [
      ...workspaces,
      { id: "B", label: "ClientApp", rootPath: "/Users/patryk/Desktop/ClientApp" },
    ];

    const client = buildSessionsProjection({
      sessions: [managedSession(), projectB],
      workspaces: allWorkspaces,
      externalSessions: [],
      projectId: "B",
    });
    const all = buildSessionsProjection({
      sessions: [managedSession(), projectB],
      workspaces: allWorkspaces,
      externalSessions: [],
      projectId: "all",
    });

    expect(client.items).toMatchObject([{ title: "Client release" }]);
    expect(client.projectCounts).toEqual(expect.objectContaining({ A: 1, B: 1 }));
    expect(all.items).toHaveLength(2);
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

  it("collapses delegated runs under their parent conversation instead of listing them as peers", () => {
    const parentId = "parent-conversation";
    const parent = externalSession(parentId, {
      title: "Implement the Sessions correction",
      updatedAt: 500,
    });
    const child = {
      ...externalSession("delegated-child", {
        lineageKey: `external-codex:${parentId}`,
        title: "Inspect projection tests",
        updatedAt: 600,
      }),
      parentContentSessionKey: `external-codex:${parentId}`,
    } as ExternalSessionSummary;

    const projection = buildSessionsProjection({
      sessions: [],
      workspaces,
      externalSessions: [child, parent],
    });

    expect(projection.items).toHaveLength(1);
    expect(projection.items[0]).toMatchObject({
      title: "Implement the Sessions correction",
      contentSessionKey: `external-codex:${parentId}`,
      delegatedRunCount: 1,
    });
    expect(projection.items.some((item) => item.title === "Inspect projection tests")).toBe(false);
  });

  it("keeps orphaned delegated runs outside the primary conversation list", () => {
    const child = {
      ...externalSession("orphan-child", {
        lineageKey: "external-codex:missing-parent",
        title: "Internal delegated task",
      }),
      parentContentSessionKey: "external-codex:missing-parent",
    } as ExternalSessionSummary;

    const projection = buildSessionsProjection({
      sessions: [],
      workspaces,
      externalSessions: [child],
    });

    expect(projection.items).toHaveLength(0);
    expect(projection.technicalRunCount).toBe(1);
  });

  it("does not expose injected runtime envelopes as managed conversation titles", () => {
    const projection = buildSessionsProjection({
      sessions: [managedSession({
        id: "polluted-managed",
        title: "Codex · <recommended_plugins> Here is a list of plugins that are available but not installed.",
      })],
      workspaces,
      externalSessions: [],
    });

    expect(projection.items[0]?.title).toBe("Codex session");
    expect(JSON.stringify(projection.items)).not.toContain("recommended_plugins");
  });

  it("chooses a managed lineage representative independently of input order or external activity", () => {
    const externalId = "019fff00-7777-7222-8333-444444444444";
    const external = externalSession(externalId, { updatedAt: 1_000 });
    const newest = managedSession({
      id: "managed-newest",
      runtimeStatus: "live",
      lastActivityAt: 500,
      resumeTarget: { agentKind: "codex", sessionId: externalId, source: "codex-session-index" },
    });
    const older = managedSession({
      id: "managed-older",
      runtimeStatus: "restored",
      lastActivityAt: 100,
      resumeTarget: { agentKind: "codex", sessionId: externalId, source: "codex-session-index" },
    });
    const equalAlpha = managedSession({
      id: "managed-alpha",
      runtimeStatus: "live",
      lastActivityAt: 300,
      resumeTarget: { agentKind: "codex", sessionId: externalId, source: "codex-session-index" },
    });
    const equalBeta = managedSession({
      id: "managed-beta",
      runtimeStatus: "restored",
      lastActivityAt: 300,
      resumeTarget: { agentKind: "codex", sessionId: externalId, source: "codex-session-index" },
    });

    const newestFirst = buildSessionsProjection({
      sessions: [newest, older],
      workspaces,
      externalSessions: [external],
    });
    const newestLast = buildSessionsProjection({
      sessions: [older, newest],
      workspaces,
      externalSessions: [external],
    });
    const alphaFirst = buildSessionsProjection({
      sessions: [equalAlpha, equalBeta],
      workspaces,
      externalSessions: [external],
    });
    const alphaLast = buildSessionsProjection({
      sessions: [equalBeta, equalAlpha],
      workspaces,
      externalSessions: [external],
    });

    for (const projection of [newestFirst, newestLast]) {
      expect(projection.items).toMatchObject([{
        sessionKey: "managed:managed-newest",
        lifecycle: "live",
        contentSessionKey: `external-codex:${externalId}`,
      }]);
      expect(projection.managedTargets.get("managed:managed-newest")).toEqual({
        workspaceId: "A",
        sessionId: "managed-newest",
      });
    }

    for (const projection of [alphaFirst, alphaLast]) {
      expect(projection.items).toMatchObject([{
        sessionKey: "managed:managed-alpha",
        lifecycle: "live",
        contentSessionKey: `external-codex:${externalId}`,
      }]);
      expect(projection.managedTargets.get("managed:managed-alpha")).toEqual({
        workspaceId: "A",
        sessionId: "managed-alpha",
      });
    }
  });

  it("matches every normalized search token across approved display metadata only", () => {
    const session = managedSession({
      id: "hidden-managed-id",
      title: "Codex · visible title",
      workspaceId: "SECRET-WORKSPACE-ID",
      cwd: "/private/secret-location",
      resumeTarget: {
        agentKind: "codex",
        sessionId: "hidden-external-content-id",
        source: "codex-session-index",
      },
    });
    const searchableWorkspaces = [{ id: "SECRET-WORKSPACE-ID", label: "Alfred", rootPath: "/private" }];

    const positive = buildSessionsProjection({
      sessions: [session],
      workspaces: searchableWorkspaces,
      externalSessions: [],
      query: "  ALFRED    codex ",
    });
    const missingToken = buildSessionsProjection({
      sessions: [session],
      workspaces: searchableWorkspaces,
      externalSessions: [],
      query: "alfred unavailable",
    });

    expect(positive.items).toHaveLength(1);
    expect(missingToken.items).toHaveLength(0);
    for (const query of ["hidden-managed-id", "SECRET-WORKSPACE-ID", "/private/secret-location", "hidden-external-content-id"]) {
      expect(buildSessionsProjection({
        sessions: [session],
        workspaces: searchableWorkspaces,
        externalSessions: [],
        query,
      }).items).toHaveLength(0);
    }
  });
});
