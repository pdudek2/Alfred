import { describe, expect, it, vi } from "vitest";
import { registerSessionsIpc } from "./sessions-ipc.js";
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
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
