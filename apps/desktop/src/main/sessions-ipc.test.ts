import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerSessionsIpc } from "./sessions-ipc.js";
import { createCodexSessionsReader } from "./codex-sessions.js";
import { sessionsChannels } from "../shared/sessions-ipc.js";

const handlers = new Map<string, (event: unknown, request: unknown) => unknown>();

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (event: unknown, request: unknown) => unknown) => handlers.set(channel, handler)) },
}));

describe("sessions IPC", () => {
  it("returns an empty page and clears cached sources when indexing is disabled", async () => {
    const reader = {
      listExternalSessions: vi.fn(),
      resolveExternalSession: vi.fn(),
      clear: vi.fn(),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => false });

    await expect(handlers.get(sessionsChannels.listExternal)?.({}, { projects: [] })).resolves.toEqual({
      sessions: [],
      nextCursor: null,
      total: 0,
    });
    expect(reader.clear).toHaveBeenCalledOnce();
  });

  it("returns an empty page when indexing is disabled while a refresh is in flight", async () => {
    let enabled = true;
    const listing = deferred<{ sessions: Array<{ sessionKey: string }>; nextCursor: string | null; total: number }>();
    const reader = {
      listExternalSessions: vi.fn(() => listing.promise),
      resolveExternalSession: vi.fn(),
      clear: vi.fn(),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => enabled });

    const response = handlers.get(sessionsChannels.listExternal)?.({}, { projects: [] });
    enabled = false;
    listing.resolve({ sessions: [{ sessionKey: "stale" }], nextCursor: null, total: 1 });

    await expect(response).resolves.toEqual({ sessions: [], nextCursor: null, total: 0 });
    expect(reader.clear).toHaveBeenCalledOnce();
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
      clear: vi.fn(() => { populated = false; }),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => true });

    const response = handlers.get(sessionsChannels.listExternal)?.({}, { projects: [] });
    await vi.waitFor(() => expect(reader.listExternalSessions).toHaveBeenCalledOnce());
    await handlers.get(sessionsChannels.clearCaches)?.({}, undefined);
    listing.resolve({ sessions: [{ sessionKey: "stale" }], nextCursor: null, total: 1 });

    await expect(response).resolves.toEqual({ sessions: [], nextCursor: null, total: 0 });
    await expect(reader.resolveExternalSession({ sessionKey: "stale" })).resolves.toEqual({ kind: "none" });
    expect(reader.clear).toHaveBeenCalledTimes(2);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
