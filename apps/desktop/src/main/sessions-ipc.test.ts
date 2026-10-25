import { describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerSessionsIpc } from "./sessions-ipc.js";
import { createExternalSessionsReader } from "./external-sessions.js";
import { managedProjectWorktreeRoot } from "./git-worktree.js";
import { sessionsChannels } from "../shared/sessions-ipc.js";
import type { WorkspaceStore } from "./workspace-store.js";

const handlers = new Map<string, (event: unknown, request: unknown) => unknown>();

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (event: unknown, request: unknown) => unknown) => handlers.set(channel, handler)) },
}));

vi.mock("./trusted-ipc.js", async () => {
  const { ipcMain } = await import("electron");
  return { trustedIpc: ipcMain };
});

type SessionsReader = ReturnType<typeof createExternalSessionsReader>;

function readerDefaults(): Pick<SessionsReader, "releaseListSnapshot" | "readTranscriptPage" | "getDiagnostics"> {
  return {
    releaseListSnapshot: vi.fn((_request: Parameters<SessionsReader["releaseListSnapshot"]>[0]) => {}),
    readTranscriptPage: vi.fn(async ({ sessionKey }: Parameters<SessionsReader["readTranscriptPage"]>[0]) => ({
      sessionKey,
      blocks: [],
      nextCursor: null,
      revision: "",
      partial: false,
    })),
    getDiagnostics: vi.fn(() => ({
      cachedSessionCount: 0,
      decodedTranscriptBytes: 0,
      summaryCount: 0,
      summaryBytes: 0,
      resumeAliasCount: 0,
      contentAliasCount: 0,
    })),
  };
}

describe("sessions IPC", () => {
  it("replaces renderer project roots with authoritative workspace roots before discovery", async () => {
    const reader = {
      ...readerDefaults(),
      listExternalSessions: vi.fn(async () => ({ sessions: [], nextCursor: null, total: 0 })),
      resolveExternalSession: vi.fn(),
    };
    registerSessionsIpc({
      reader,
      workspaceStore: fakeWorkspaceStore([{ id: "A", label: "Authoritative", shortLabel: "AU", rootPath: "/authoritative/root" }]),
    });

    await handlers.get(sessionsChannels.listExternal)?.({}, {
      projects: [{ id: "A", label: "Injected", rootPath: "/malicious/root" }],
      query: "needle",
      limit: 20,
    });

    expect(reader.listExternalSessions).toHaveBeenCalledWith({
      projects: [{ id: "A", label: "Authoritative", rootPath: "/authoritative/root" }],
      query: "needle",
      limit: 20,
    });
  });

  it("releases only the unfinished list snapshot through IPC", async () => {
    const reader = {
      ...readerDefaults(),
      listExternalSessions: vi.fn(),
      releaseListSnapshot: vi.fn(),
      resolveExternalSession: vi.fn(),
    };
    registerSessionsIpc({ reader });
    const releaseHandler = handlers.get("alfred:sessions:release-list-snapshot");

    expect(releaseHandler).toBeTypeOf("function");
    await releaseHandler?.({}, { cursor: "opaque-list-cursor" });

    expect(reader.releaseListSnapshot).toHaveBeenCalledWith({ cursor: "opaque-list-cursor" });
  });

  it("rejects a resumable result when the authoritative workspace roots no longer match", async () => {
    const reader = {
      ...readerDefaults(),
      listExternalSessions: vi.fn(),
      resolveExternalSession: vi.fn(async () => ({ kind: "resume" as const, projectId: "A", cwd: "/authoritative/root/.alfred-worktrees/feature", sessionId: "stale", agentKind: "codex" as const })),
    };
    registerSessionsIpc({
      reader,
      workspaceStore: fakeWorkspaceStore([{ id: "A", label: "Authoritative", shortLabel: "AU", rootPath: "/other/root" }]),
    });

    await expect(handlers.get(sessionsChannels.resolveExternal)?.({}, { sessionKey: "stale" })).resolves.toEqual({ kind: "add-project" });
  });

  it("authorizes resume targets inside the configured managed worktree root", async () => {
    const projectRoot = path.join(tmpdir(), "authoritative-root");
    const managedWorktreeRootPath = path.join(tmpdir(), "alfred-user-data", "worktrees");
    const managedCwd = path.join(managedProjectWorktreeRoot(managedWorktreeRootPath, projectRoot), "feature-a");
    const reader = {
      ...readerDefaults(),
      listExternalSessions: vi.fn(),
      resolveExternalSession: vi.fn(async () => ({
        kind: "resume" as const,
        projectId: "A",
        cwd: managedCwd,
        sessionId: "managed-session",
        agentKind: "codex" as const,
      })),
    };
    registerSessionsIpc({
      managedWorktreeRootPath,
      reader,
      workspaceStore: fakeWorkspaceStore([{ id: "A", label: "Authoritative", shortLabel: "AU", rootPath: projectRoot }]),
    });

    await expect(handlers.get(sessionsChannels.resolveExternal)?.({}, { sessionKey: "managed" })).resolves.toEqual({
      kind: "resume",
      projectId: "A",
      cwd: managedCwd,
      sessionId: "managed-session",
      agentKind: "codex" as const,
    });
  });

  it("rejects a resumable cwd that escapes an authoritative workspace through dot segments", async () => {
    const root = path.join(tmpdir(), "authoritative-root");
    const reader = {
      ...readerDefaults(),
      listExternalSessions: vi.fn(),
      releaseListSnapshot: vi.fn(),
      resolveExternalSession: vi.fn(async () => ({
        kind: "resume" as const,
        projectId: "A",
        cwd: `${root}/../outside`,
        sessionId: "escaped",
        agentKind: "codex" as const,
      })),
    };
    registerSessionsIpc({
      reader,
      workspaceStore: fakeWorkspaceStore([{ id: "A", label: "Authoritative", shortLabel: "AU", rootPath: root }]),
    });

    await expect(handlers.get(sessionsChannels.resolveExternal)?.({}, { sessionKey: "escaped" }))
      .resolves.toEqual({ kind: "add-project" });
  });

  it("validates transcript page requests", async () => {
    const reader = {
      ...readerDefaults(),
      listExternalSessions: vi.fn(),
      resolveExternalSession: vi.fn(),
      readTranscriptPage: vi.fn(() => Promise.resolve({ sessionKey: "known", blocks: [], nextCursor: null, revision: "1", partial: false })),
      getDiagnostics: vi.fn(() => ({
        cachedSessionCount: 0,
        decodedTranscriptBytes: 0,
        summaryCount: 0,
        summaryBytes: 0,
        resumeAliasCount: 0,
        contentAliasCount: 0,
      })),
    };
    registerSessionsIpc({ reader });

    await expect(handlers.get(sessionsChannels.readTranscriptPage)?.({}, { sessionKey: "known", cursor: 12 })).rejects.toThrow("Invalid transcript page request.");
    await expect(handlers.get(sessionsChannels.getDiagnostics)?.({}, undefined)).resolves.toMatchObject({ cachedSessionCount: 0 });
    await expect(handlers.get(sessionsChannels.readTranscriptPage)?.({}, { sessionKey: "known" })).resolves.toMatchObject({ sessionKey: "known", revision: "1" });
  });
});

function fakeWorkspaceStore(workspaces: Array<{ id: string; label: string; shortLabel: string; rootPath?: string }>): WorkspaceStore {
  return {
    bindWorkspaceToPath: vi.fn(),
    createWorkspaceFromPath: vi.fn(),
    getWorkspaceState: vi.fn(async () => ({ workspaces, activeWorkspaceId: workspaces[0]?.id ?? "A" })),
    setWorkspaceState: vi.fn(),
  };
}

