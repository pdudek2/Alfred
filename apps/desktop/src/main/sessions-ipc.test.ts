import { describe, expect, it, vi } from "vitest";
import { registerSessionsIpc } from "./sessions-ipc.js";
import { sessionsChannels } from "../shared/sessions-ipc.js";

const handlers = new Map<string, (request: unknown) => unknown>();

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: (request: unknown) => unknown) => handlers.set(channel, handler)) },
}));

describe("sessions IPC", () => {
  it("returns an empty page and clears cached sources when indexing is disabled", async () => {
    const reader = {
      listExternalSessions: vi.fn(),
      resolveExternalSession: vi.fn(),
      clear: vi.fn(),
    };
    registerSessionsIpc({ reader, isExternalSessionIndexingEnabled: () => false });

    await expect(handlers.get(sessionsChannels.listExternal)?.({ projects: [] })).resolves.toEqual({
      sessions: [],
      nextCursor: null,
      total: 0,
    });
    expect(reader.clear).toHaveBeenCalledOnce();
  });
});
