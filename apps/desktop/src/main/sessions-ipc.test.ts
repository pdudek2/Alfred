import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerSessionsIpc } from "./sessions-ipc.js";
import { createCodexSessionsReader } from "./codex-sessions.js";
import { sessionsChannels } from "../shared/sessions-ipc.js";
import type { WorkspaceStore } from "./workspace-store.js";

const handlers = new Map<string, (event: unknown, request: unknown) => unknown>();

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (event: unknown, request: unknown) => unknown) => handlers.set(channel, handler)) },
}));

describe("sessions IPC", () => {
  it("replaces renderer project roots with authoritative workspace roots before discovery", async () => {
    const reader = {
      listExternalSessions: vi.fn(async () => ({ sessions: [], nextCursor: null, total: 0 })),
      resolveExternalSession: vi.fn(),
      clearCaches: vi.fn(),
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

  it("rejects a resumable result when the authoritative workspace roots no longer match", async () => {
    const reader = {
      listExternalSessions: vi.fn(),
      resolveExternalSession: vi.fn(async () => ({ kind: "resume" as const, projectId: "A", cwd: "/authoritative/root/.alfred-worktrees/feature", sessionId: "stale" })),
      clearCaches: vi.fn(),
    };
    registerSessionsIpc({
      reader,
      workspaceStore: fakeWorkspaceStore([{ id: "A", label: "Authoritative", shortLabel: "AU", rootPath: "/other/root" }]),
    });

    await expect(handlers.get(sessionsChannels.resolveExternal)?.({}, { sessionKey: "stale" })).resolves.toEqual({ kind: "add-project" });
  });

  it("returns an empty page and clears cached sources when indexing is disabled", async () => {
    const reader = {
      listExternalSessions: vi.fn(),
      resolveExternalSession: vi.fn(),
      clearCaches: vi.fn(),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => false });

    await expect(handlers.get(sessionsChannels.listExternal)?.({}, { projects: [] })).resolves.toEqual({
      sessions: [],
      nextCursor: null,
      total: 0,
    });
    expect(reader.clearCaches).toHaveBeenCalledOnce();
  });

  it("returns an empty page when indexing is disabled while a refresh is in flight", async () => {
    let enabled = true;
    const listing = deferred<{ sessions: Array<{ sessionKey: string }>; nextCursor: string | null; total: number }>();
    const reader = {
      listExternalSessions: vi.fn(() => listing.promise),
      resolveExternalSession: vi.fn(),
      clearCaches: vi.fn(),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => enabled });

    const response = handlers.get(sessionsChannels.listExternal)?.({}, { projects: [] });
    enabled = false;
    listing.resolve({ sessions: [{ sessionKey: "stale" }], nextCursor: null, total: 1 });

    await expect(response).resolves.toEqual({ sessions: [], nextCursor: null, total: 0 });
    expect(reader.clearCaches).toHaveBeenCalledOnce();
  });

  it("clears populated reader sources when the privacy transition requests cache clearing", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const cwd = "/repo";
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, "stale.jsonl"), JSON.stringify({ type: "session_meta", payload: { id: "stale", cwd } }));
    const reader = createCodexSessionsReader({ codexHome });
    let indexingEnabled = true;
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => indexingEnabled });

    const populated = await handlers.get(sessionsChannels.listExternal)?.({}, { projects: [{ id: "A", label: "Alfred", rootPath: cwd }] }) as {
      sessions: Array<{ sessionKey: string }>;
    };
    indexingEnabled = false;
    await handlers.get(sessionsChannels.clearCaches)?.({}, undefined);

    await expect(reader.resolveExternalSession({ sessionKey: populated.sessions[0]!.sessionKey })).resolves.toEqual({ kind: "none" });
  });

  it("discards a list that repopulates reader sources after clearCaches while indexing remains enabled", async () => {
    let populated = false;
    const listing = deferred<{ sessions: Array<{ sessionKey: string }>; nextCursor: null; total: number }>();
    const reader = {
      listExternalSessions: vi.fn(() => listing.promise.then((result) => {
        populated = true;
        return result;
      })),
      resolveExternalSession: vi.fn(() => Promise.resolve(populated ? { kind: "resume" as const, projectId: "A", cwd: "/repo", sessionId: "stale" } : { kind: "none" as const })),
      clearCaches: vi.fn(() => { populated = false; }),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => true });

    const response = handlers.get(sessionsChannels.listExternal)?.({}, { projects: [] });
    await vi.waitFor(() => expect(reader.listExternalSessions).toHaveBeenCalledOnce());
    const clearPromise = handlers.get(sessionsChannels.clearCaches)?.({}, undefined);
    listing.resolve({ sessions: [{ sessionKey: "stale" }], nextCursor: null, total: 1 });

    await clearPromise;
    await expect(response).resolves.toEqual({ sessions: [], nextCursor: null, total: 0 });
    await expect(reader.resolveExternalSession({ sessionKey: "stale" })).resolves.toEqual({ kind: "none" });
    expect(reader.clearCaches).toHaveBeenCalledOnce();
  });

  it("keeps a newer list source resolvable after an older generation completes", async () => {
    const older = deferred<{ sessions: Array<{ sessionKey: string }>; nextCursor: null; total: number }>();
    const newer = deferred<{ sessions: Array<{ sessionKey: string }>; nextCursor: null; total: number }>();
    const sources = new Set<string>();
    const reader = {
      listExternalSessions: vi
        .fn()
        .mockImplementationOnce(() => older.promise.then((result) => { result.sessions.forEach((session) => sources.add(session.sessionKey)); return result; }))
        .mockImplementationOnce(() => newer.promise.then((result) => { result.sessions.forEach((session) => sources.add(session.sessionKey)); return result; })),
      resolveExternalSession: vi.fn(({ sessionKey }: { sessionKey: string }) => Promise.resolve(
        sources.has(sessionKey)
          ? { kind: "resume" as const, projectId: "A", cwd: "/repo", sessionId: sessionKey }
          : { kind: "none" as const },
      )),
      clearCaches: vi.fn(() => { sources.clear(); }),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => true });

    const olderResponse = handlers.get(sessionsChannels.listExternal)?.({}, { projects: [] });
    await vi.waitFor(() => expect(reader.listExternalSessions).toHaveBeenCalledOnce());
    const clearPromise = handlers.get(sessionsChannels.clearCaches)?.({}, undefined);
    const newerResponse = handlers.get(sessionsChannels.listExternal)?.({}, { projects: [] });

    await Promise.resolve();
    expect(reader.listExternalSessions).toHaveBeenCalledOnce();
    older.resolve({ sessions: [{ sessionKey: "older" }], nextCursor: null, total: 1 });
    await vi.waitFor(() => expect(reader.listExternalSessions).toHaveBeenCalledTimes(2));
    newer.resolve({ sessions: [{ sessionKey: "newer" }], nextCursor: null, total: 1 });

    await expect(olderResponse).resolves.toEqual({ sessions: [], nextCursor: null, total: 0 });
    await expect(newerResponse).resolves.toEqual({ sessions: [{ sessionKey: "newer" }], nextCursor: null, total: 1 });
    await clearPromise;
    await expect(reader.resolveExternalSession({ sessionKey: "newer" })).resolves.toMatchObject({ kind: "resume", sessionId: "newer" });
  });

  it("validates transcript page requests and clears all reader caches when indexing becomes disabled", async () => {
    let enabled = true;
    const reader = {
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
      clearCaches: vi.fn(),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => enabled });

    await expect(handlers.get(sessionsChannels.readTranscriptPage)?.({}, { sessionKey: "known", cursor: 12 })).rejects.toThrow("Invalid transcript page request.");
    await expect(handlers.get(sessionsChannels.getDiagnostics)?.({}, undefined)).resolves.toMatchObject({ cachedSessionCount: 0 });
    enabled = false;
    await expect(handlers.get(sessionsChannels.readTranscriptPage)?.({}, { sessionKey: "known" })).resolves.toEqual({ sessionKey: "known", blocks: [], nextCursor: null, revision: "", partial: false });
    expect(reader.clearCaches).toHaveBeenCalledOnce();
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
