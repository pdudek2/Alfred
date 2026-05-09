import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserWindow, ipcMain } from "electron";
import {
  configureTerminalPersistence,
  getTerminalSessionCount,
  killAllTerminalSessions,
  registerTerminalIpc,
  resetTerminalPersistenceForTests,
} from "./terminal-manager.js";
import { terminalChannels } from "../shared/terminal-ipc.js";
import type { TerminalCreateRequest } from "../shared/terminal-ipc.js";
import { DEFAULT_DESKTOP_STATE, type DesktopStateSnapshot, type PersistedDesktopStateStore } from "./persisted-desktop-state.js";

type IpcInvokeHandler = (event: { sender: object }, request?: unknown) => unknown;
type IpcEventHandler = (event: { sender: object }, request: unknown) => void;

const invokeHandlers = new Map<string, IpcInvokeHandler>();
const eventHandlers = new Map<string, IpcEventHandler>();
const sentEvents: Array<{ channel: string; payload: unknown; windowId: number }> = [];
let liveWindows: Array<ReturnType<typeof fakeWindow>> = [];

class FakePty {
  onDataHandler: ((data: string) => void) | null = null;
  onExitHandler: ((event: { exitCode: number; signal?: number }) => void) | null = null;
  killed = false;
  resized: Array<{ cols: number; rows: number }> = [];
  writes: string[] = [];

  onData(handler: (data: string) => void): void {
    this.onDataHandler = handler;
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): void {
    this.onExitHandler = handler;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resized.push({ cols, rows });
  }

  kill(): void {
    this.killed = true;
  }
}

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/Users/patryk/Desktop/Alfred/apps/desktop",
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn(() => liveWindows),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcInvokeHandler) => {
      invokeHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: IpcEventHandler) => {
      eventHandlers.set(channel, handler);
    }),
  },
}));

function fakeWindow(id = 1, destroyed = false) {
  return {
    id,
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload: unknown) => {
        sentEvents.push({ channel, payload, windowId: id });
      },
    },
  };
}

function fakeNodePty(pty: FakePty) {
  return {
    spawn: vi.fn(() => pty),
  };
}

function senderFor(window: ReturnType<typeof fakeWindow>): object {
  return { window };
}

async function invoke<T>(
  channel: string,
  request?: unknown,
  sender: object = senderFor(liveWindows[0] ?? fakeWindow()),
): Promise<T> {
  const handler = invokeHandlers.get(channel);
  if (!handler) throw new Error(`Missing invoke handler for ${channel}`);
  return handler({ sender }, request) as Promise<T>;
}

function emit(channel: string, request: unknown, sender: object = senderFor(liveWindows[0] ?? fakeWindow())): void {
  const handler = eventHandlers.get(channel);
  if (!handler) throw new Error(`Missing event handler for ${channel}`);
  handler({ sender }, request);
}

describe("terminal-manager IPC", () => {
  beforeEach(() => {
    killAllTerminalSessions();
    resetTerminalPersistenceForTests();
    invokeHandlers.clear();
    eventHandlers.clear();
    sentEvents.length = 0;
    vi.clearAllMocks();
    liveWindows = [fakeWindow(1)];
    vi.mocked(BrowserWindow.fromWebContents).mockImplementation(
      (sender) => (sender as { window?: ReturnType<typeof fakeWindow> }).window as never,
    );
  });

  it("persists transcript snapshots and returns them as restored sessions after restart", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
    };
    const pty = new FakePty();
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "manual-1",
      command: "node",
      cols: 80,
      rows: 24,
      title: "Manual terminal",
    });
    pty.onDataHandler?.("Server ready\n");
    await Promise.resolve();
    await Promise.resolve();

    expect(state.restoredTerminalSessions).toEqual([
      expect.objectContaining({
        clientId: "manual-1",
        title: "Manual terminal",
        buffer: "Server ready\n",
        activityEvents: [
          expect.objectContaining({
            kind: "output",
            title: "Progress reported",
            detail: "Server ready",
          }),
        ],
      }),
    ]);

    killAllTerminalSessions();
    const listed = await invoke<{ sessions: unknown[]; restoredSessions: unknown[] }>(terminalChannels.list);

    expect(listed.sessions).toEqual([]);
    expect(listed.restoredSessions).toEqual([
      expect.objectContaining({
        clientId: "manual-1",
        buffer: "Server ready\n",
        activityEvents: [
          expect.objectContaining({
            kind: "output",
            title: "Progress reported",
            detail: "Server ready",
          }),
        ],
      }),
    ]);
  });

  it("forgets restored terminal snapshots without reviving them on process exit", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "manual-1",
          title: "Manual terminal",
          source: "manual",
          cwd: "/repo",
          shell: "/bin/zsh",
          buffer: "saved output\n",
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
    };
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(new FakePty()) as never });

    await invoke(terminalChannels.list);
    emit(terminalChannels.forget, { clientId: "manual-1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(state.restoredTerminalSessions).toEqual([]);
  });

  it("creates a terminal session, streams data to the attached window, and rehydrates from list", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    registerTerminalIpc({ loadNodePty: async () => nodePty as never });

    const request: TerminalCreateRequest = {
      args: ["--version"],
      clientId: "manual-1",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      source: "manual",
      title: "Manual terminal",
    };

    const created = await invoke<{ id: string }>(terminalChannels.create, request);
    pty.onDataHandler?.("hello\n");
    const listed = await invoke<{ sessions: Array<{ id: string; buffer: string }> }>(terminalChannels.list);

    expect(ipcMain.handle).toHaveBeenCalledWith(terminalChannels.create, expect.any(Function));
    expect(nodePty.spawn).toHaveBeenCalledWith(
      "node",
      ["--version"],
      expect.objectContaining({ cols: 80, cwd: "/repo", rows: 24 }),
    );
    expect(sentEvents).toContainEqual({
      channel: terminalChannels.data,
      payload: { id: created.id, data: "hello\n" },
      windowId: 1,
    });
    expect(listed.sessions).toEqual([
      expect.objectContaining({ id: created.id, buffer: "hello\n", clientId: "manual-1" }),
    ]);
  });

  it("supports write, resize, kill, and session count", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    const created = await invoke<{ id: string }>(terminalChannels.create, {
      command: "node",
      cols: 80,
      rows: 24,
    });

    expect(getTerminalSessionCount()).toBe(1);
    emit(terminalChannels.write, { id: created.id, data: "echo ok\r" });
    emit(terminalChannels.resize, { id: created.id, cols: 100, rows: 32 });
    emit(terminalChannels.kill, { id: created.id });

    expect(pty.writes).toEqual(["echo ok\r"]);
    expect(pty.resized).toEqual([{ cols: 100, rows: 32 }]);
    expect(pty.killed).toBe(true);
    expect(getTerminalSessionCount()).toBe(0);
  });

  it("rejects terminal operations from a different live window", async () => {
    const ownerWindow = fakeWindow(1);
    const otherWindow = fakeWindow(2);
    liveWindows = [ownerWindow, otherWindow];
    const ownerSender = senderFor(ownerWindow);
    const otherSender = senderFor(otherWindow);
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    const created = await invoke<{ id: string }>(
      terminalChannels.create,
      { command: "node", cols: 80, rows: 24 },
      ownerSender,
    );
    const otherList = await invoke<{ sessions: Array<{ id: string }> }>(terminalChannels.list, undefined, otherSender);
    emit(terminalChannels.write, { id: created.id, data: "stolen\r" }, otherSender);
    emit(terminalChannels.resize, { id: created.id, cols: 120, rows: 40 }, otherSender);
    emit(terminalChannels.kill, { id: created.id }, otherSender);

    expect(otherList.sessions).toEqual([]);
    expect(pty.writes).toEqual([]);
    expect(pty.resized).toEqual([]);
    expect(pty.killed).toBe(false);
    expect(getTerminalSessionCount()).toBe(1);
  });

  it("reattaches sessions to a new window when the original owner is gone", async () => {
    const oldWindow = fakeWindow(1);
    const newWindow = fakeWindow(2);
    const oldSender = senderFor(oldWindow);
    const newSender = senderFor(newWindow);
    const pty = new FakePty();
    liveWindows = [oldWindow];
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    const created = await invoke<{ id: string }>(
      terminalChannels.create,
      { command: "node", cols: 80, rows: 24 },
      oldSender,
    );
    liveWindows = [newWindow];
    const listed = await invoke<{ sessions: Array<{ id: string }> }>(terminalChannels.list, undefined, newSender);
    pty.onDataHandler?.("after reattach\n");
    emit(terminalChannels.write, { id: created.id, data: "ok\r" }, newSender);

    expect(listed.sessions).toEqual([expect.objectContaining({ id: created.id })]);
    expect(sentEvents).toContainEqual({
      channel: terminalChannels.data,
      payload: { id: created.id, data: "after reattach\n" },
      windowId: 2,
    });
    expect(pty.writes).toEqual(["ok\r"]);
  });

  it("rejects create requests without an owning window", async () => {
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(new FakePty()) as never });
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);

    await expect(
      invoke(terminalChannels.create, { command: "node", cols: 80, rows: 24 }),
    ).rejects.toThrow("Terminal session requires an owning window.");
    expect(getTerminalSessionCount()).toBe(0);
  });
});
