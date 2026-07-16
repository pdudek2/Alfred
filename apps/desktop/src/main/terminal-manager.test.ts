import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  configureTerminalPersistence,
  flushTerminalPersistence,
  getTerminalSessionCount,
  killAllTerminalSessions,
  registerTerminalIpc as registerTerminalIpcBase,
  resetTerminalPersistenceForTests,
} from "./terminal-manager.js";
import { terminalChannels } from "../shared/terminal-ipc.js";
import type {
  PersistedTerminalSessionSnapshot,
  TerminalCreateRequest,
  TerminalDataEvent,
  TerminalListResult,
} from "../shared/terminal-ipc.js";
import type { TerminalSnapshotResult } from "../shared/terminal-ipc.js";
import type { AgentWorktreeCleanupRequest } from "./git-worktree.js";
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function defaultAllowedCwdRoots(): string[] {
  return [
    "/repo",
    "/tmp/alfred-scratch",
    "/alfred/userData/scratch",
    "/.alfred-worktrees",
    "/alfred/userData/worktrees",
    path.join(os.homedir(), "Desktop"),
    os.homedir(),
  ];
}

function storeWithRestoredSessions(
  restoredTerminalSessions: PersistedTerminalSessionSnapshot[],
): PersistedDesktopStateStore {
  let state = stateWithRestoredSessions(restoredTerminalSessions);
  return {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (next) => {
      state = next;
      return state;
    }),
    updateState: vi.fn(async (updater) => {
      state = await updater(state);
      return state;
    }),
  };
}

function stateWithRestoredSessions(
  restoredTerminalSessions: PersistedTerminalSessionSnapshot[],
): DesktopStateSnapshot {
  return {
    ...DEFAULT_DESKTOP_STATE,
    restoredTerminalSessions,
  };
}

function registerTerminalIpc(options: Parameters<typeof registerTerminalIpcBase>[0] = {}): void {
  registerTerminalIpcBase({
    allowedCwdRoots: async () => defaultAllowedCwdRoots(),
    ...options,
  });
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("persists transcript snapshots and returns them as restored sessions after restart", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
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
      cwd: "/repo",
      rows: 24,
      title: "Manual terminal",
    });
    pty.onDataHandler?.("Server ready\nBash(\"pnpm test\")\n");
    await flushTerminalPersistence();

    expect(state.restoredTerminalSessions).toEqual([
      expect.objectContaining({
        clientId: "manual-1",
        title: "Manual terminal",
        buffer: "Server ready\nBash(\"pnpm test\")\n",
        activityEvents: [
          expect.objectContaining({
            kind: "output",
            title: "Progress reported",
            detail: "Server ready",
          }),
          expect.objectContaining({
            kind: "command",
            title: "Ran command",
            detail: "\"pnpm test\"",
            payload: { type: "command", command: "pnpm test" },
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
        buffer: "Server ready\nBash(\"pnpm test\")\n",
        activityEvents: [
          expect.objectContaining({
            kind: "output",
            title: "Progress reported",
            detail: "Server ready",
          }),
          expect.objectContaining({
            kind: "command",
            title: "Ran command",
            detail: "\"pnpm test\"",
            payload: { type: "command", command: "pnpm test" },
          }),
        ],
      }),
    ]);
  });

  it("limits persisted terminal scrollback to the latest 80,000 characters", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const pty = new FakePty();
    const retainedTail = "b".repeat(80_000);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "manual-large-buffer",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      title: "Manual terminal",
    });
    pty.onDataHandler?.(`${"a".repeat(20_000)}${retainedTail}`);
    await flushTerminalPersistence();

    expect(state.restoredTerminalSessions[0]?.buffer).toHaveLength(80_000);
    expect(state.restoredTerminalSessions[0]?.buffer).toBe(retainedTail);
  });

  it("redacts persisted terminal scrollback and activity", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const pty = new FakePty();
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "manual-secret-output",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      title: "Manual /Users/patryk/Desktop/Alfred",
    });
    pty.onDataHandler?.("Authorization: Bearer abc.def.ghi\nBash(\"echo sk-proj-1234567890abcdef\")\n");
    await flushTerminalPersistence();

    const session = state.restoredTerminalSessions[0];
    expect(session?.title).toBe("Manual [redacted-path:44c8fe0e]");
    expect(session?.buffer).toContain("Authorization: [redacted]");
    expect(session?.buffer).toContain("Bash(\"echo [redacted]\")");
    expect(session?.buffer).not.toContain("abc.def.ghi");
    expect(session?.buffer).not.toContain("sk-proj-1234567890abcdef");
    expect(session?.activityEvents).toEqual([
      expect.objectContaining({
        kind: "command",
        detail: "\"echo [redacted]\"",
        payload: { type: "command", command: "echo [redacted]" },
      }),
    ]);
  });

  it("redacts persisted restored snapshots without redacting the same-process restore cache", async () => {
    const rawBuffer = "/Users/patryk/project\nsecret=abc123def4567890\n";
    const rawTitle = "/Users/patryk/project";
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "manual-sensitive-restore",
          title: rawTitle,
          source: "manual",
          cwd: "/Users/patryk/project",
          createdAt: 1,
          shell: "/bin/zsh",
          buffer: rawBuffer,
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(new FakePty()) as never });

    await invoke<TerminalListResult>(terminalChannels.list);
    await flushTerminalPersistence();

    const persisted = state.restoredTerminalSessions[0];
    expect(persisted?.title).toContain("[redacted-path:");
    expect(persisted?.buffer).toContain("[redacted-path:");
    expect(persisted?.buffer).toContain("[redacted]");
    expect(persisted?.buffer).not.toContain("abc123def4567890");

    const listed = await invoke<TerminalListResult>(terminalChannels.list);
    const restored = listed.restoredSessions[0];
    expect(restored?.title).toBe(rawTitle);
    expect(restored?.buffer).toBe(rawBuffer);
  });

  it("drops persisted terminal scrollback and activity when retention is off", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      privacySettings: {
        ...DEFAULT_DESKTOP_STATE.privacySettings,
        terminalScrollbackRetention: "off",
      },
      restoredTerminalSessions: [],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const pty = new FakePty();
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "manual-no-retention",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      title: "Manual terminal",
    });
    pty.onDataHandler?.("Server ready\nBash(\"pnpm test\")\n");
    await flushTerminalPersistence();

    expect(state.restoredTerminalSessions[0]).toEqual(
      expect.objectContaining({
        clientId: "manual-no-retention",
        buffer: "",
      }),
    );
    expect(state.restoredTerminalSessions[0]).not.toHaveProperty("activityEvents");
  });

  it("renames live sessions and persists the updated title", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(new FakePty()) as never });

    await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "manual-1",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      title: "Manual terminal",
    });

    await invoke(terminalChannels.rename, { clientId: "manual-1", title: "  Spec   reviewer  " });
    await flushTerminalPersistence();

    expect(state.restoredTerminalSessions).toEqual([
      expect.objectContaining({
        clientId: "manual-1",
        title: "Spec reviewer",
      }),
    ]);
    expect((await invoke<TerminalListResult>(terminalChannels.list)).sessions[0]).toEqual(
      expect.objectContaining({ clientId: "manual-1", title: "Spec reviewer" }),
    );
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
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(new FakePty()) as never });

    await invoke(terminalChannels.list);
    emit(terminalChannels.forget, { clientId: "manual-1" });
    await flushTerminalPersistence();

    expect(state.restoredTerminalSessions).toEqual([]);
  });

  it("hydrates persisted terminal snapshots once across concurrent readers", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    const store = storeWithRestoredSessions([]);
    vi.mocked(store.getState).mockReturnValue(hydration.promise);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc();

    const firstList = invoke<TerminalListResult>(terminalChannels.list);
    const secondList = invoke<TerminalListResult>(terminalChannels.list);

    expect(store.getState).toHaveBeenCalledTimes(1);
    hydration.resolve(stateWithRestoredSessions([]));
    await expect(Promise.all([firstList, secondList])).resolves.toHaveLength(2);
  });

  it("does not resurrect a forgotten snapshot when in-flight hydration completes", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: "forgotten-during-hydration",
      title: "Forget me",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      buffer: "stale\n",
    };
    const store = storeWithRestoredSessions([]);
    vi.mocked(store.getState).mockReturnValue(hydration.promise);
    configureTerminalPersistence(store, { debounceMs: 60_000 });
    registerTerminalIpc();

    const pendingList = invoke<TerminalListResult>(terminalChannels.list);
    emit(terminalChannels.forget, { clientId: snapshot.clientId });
    hydration.resolve(stateWithRestoredSessions([snapshot]));

    await expect(pendingList).resolves.toEqual(expect.objectContaining({ restoredSessions: [] }));
  });

  it("does not erase a locally remembered snapshot when in-flight hydration completes", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    const staleSnapshot: PersistedTerminalSessionSnapshot = {
      clientId: "remembered-during-hydration",
      title: "Stale title",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      buffer: "stale\n",
    };
    let persistedState = stateWithRestoredSessions([]);
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(() => hydration.promise),
      setState: vi.fn(async (next) => {
        persistedState = next;
        return persistedState;
      }),
      updateState: vi.fn(async (updater) => {
        persistedState = await updater(persistedState);
        return persistedState;
      }),
    };
    const pty = new FakePty();
    configureTerminalPersistence(store, { debounceMs: 60_000 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    const pendingList = invoke<TerminalListResult>(terminalChannels.list);
    await invoke(terminalChannels.create, {
      clientId: staleSnapshot.clientId,
      cols: 80,
      cwd: "/repo",
      rows: 24,
      title: "Fresh title",
    });
    persistedState = stateWithRestoredSessions([staleSnapshot]);
    hydration.resolve(persistedState);
    await pendingList;
    await flushTerminalPersistence();

    expect(persistedState.restoredTerminalSessions).toEqual([
      expect.objectContaining({ clientId: staleSnapshot.clientId, title: "Fresh title" }),
    ]);
  });

  it("flushes pending terminal snapshots without waiting for the debounce timer", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const pty = new FakePty();
    configureTerminalPersistence(store, { debounceMs: 60_000 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "manual-1",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      title: "Manual terminal",
    });
    pty.onDataHandler?.("Server ready\n");

    await flushTerminalPersistence();

    expect(state.restoredTerminalSessions).toEqual([
      expect.objectContaining({
        clientId: "manual-1",
        buffer: "Server ready\n",
      }),
    ]);
  });

  it("records a stopped-on-quit event before killing app-scoped sessions", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
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
      cwd: "/repo",
      rows: 24,
      title: "Manual terminal",
    });
    killAllTerminalSessions();
    await flushTerminalPersistence();

    expect(pty.killed).toBe(true);
    expect(state.restoredTerminalSessions[0]?.activityEvents).toEqual([
      expect.objectContaining({
        kind: "lifecycle",
        title: "Stopped on quit",
        detail: "Alfred stopped this terminal while quitting.",
      }),
    ]);
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
    pty.onExitHandler?.({ exitCode: 0 });
    const listed = await invoke<{ sessions: Array<{ id: string; buffer: string }> }>(terminalChannels.list);

    expect(ipcMain.handle).toHaveBeenCalledWith(terminalChannels.create, expect.any(Function));
    expect(nodePty.spawn).toHaveBeenCalledWith(
      "node",
      ["--version"],
      expect.objectContaining({ cols: 80, cwd: "/repo", rows: 24 }),
    );
    expect(sentEvents).toContainEqual({
      channel: terminalChannels.data,
      payload: { id: created.id, clientId: "manual-1", data: "hello\n", activities: [] },
      windowId: 1,
    });
    expect(sentEvents).toContainEqual({
      channel: terminalChannels.exit,
      payload: { id: created.id, clientId: "manual-1", exitCode: 0 },
      windowId: 1,
    });
    expect(listed.sessions).toEqual([]);
  });

  it("reserves a client id while terminal creation is in flight", async () => {
    const loadPty = deferred<ReturnType<typeof fakeNodePty>>();
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({ loadNodePty: async () => loadPty.promise as never });
    const request: TerminalCreateRequest = {
      clientId: "one-generation",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      source: "manual",
    };

    const first = invoke(terminalChannels.create, request);
    const second = invoke(terminalChannels.create, request);
    loadPty.resolve(nodePty);

    const results = await Promise.allSettled([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected")).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: "Terminal client id is already active." }),
    }));
    expect(nodePty.spawn).toHaveBeenCalledTimes(1);
  });

  it("classifies a split approval once and sends the persisted event with terminal data", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      command: "node", cols: 80, cwd: "/repo", rows: 24,
    });

    pty.onDataHandler?.("Approval re");
    pty.onDataHandler?.("quired: apply patch?");

    const dataEvents = sentEvents.filter((event) => event.channel === terminalChannels.data);
    const emittedActivity = (dataEvents[1]?.payload as TerminalDataEvent).activities[0];
    const listed = await invoke<TerminalListResult>(terminalChannels.list);
    const persistedActivity = listed.sessions[0]?.activityEvents?.[0];

    expect(dataEvents[0]).toEqual({
      channel: terminalChannels.data,
      payload: { id: created.id, data: "Approval re", activities: [] },
      windowId: 1,
    });
    expect(emittedActivity).toEqual(persistedActivity);
    expect(emittedActivity).toEqual(expect.objectContaining({
      id: expect.any(String),
      at: expect.any(Number),
      kind: "approval",
      title: "Waiting for approval",
      detail: "Approval required: apply patch?",
      payload: { type: "approval", prompt: "Approval required: apply patch?" },
    }));
  });

  it("does not emit a classified activity suppressed as a duplicate", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      command: "node", cols: 80, cwd: "/repo", rows: 24,
    });

    pty.onDataHandler?.("Bash(\"pnpm test\")\n");
    pty.onDataHandler?.("Bash(\"pnpm test\")\n");

    const dataEvents = sentEvents.filter((event) => event.channel === terminalChannels.data);
    expect(dataEvents.at(-1)).toEqual({
      channel: terminalChannels.data,
      payload: { id: created.id, data: "Bash(\"pnpm test\")\n", activities: [] },
      windowId: 1,
    });
  });

  it("keeps same-chunk activity ids unique after the retained event cap", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "manual-capped",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    });
    for (let index = 0; index < 40; index += 1) {
      pty.onDataHandler?.(`Bash("seed-${index}")\n`);
    }

    const overflowChunk = 'Bash("overflow-a")\nBash("overflow-b")\n';
    pty.onDataHandler?.(overflowChunk);

    const emitted = sentEvents
      .filter((event) => event.channel === terminalChannels.data)
      .at(-1)?.payload as TerminalDataEvent;
    const listed = await invoke<TerminalListResult>(terminalChannels.list);
    const retainedLatest = listed.sessions[0]?.activityEvents?.slice(-2);

    expect(emitted).toMatchObject({ id: created.id, data: overflowChunk });
    expect(emitted.activities.map((activity) => activity.detail)).toEqual([
      '"overflow-a"',
      '"overflow-b"',
    ]);
    expect([...new Set(emitted.activities.map((activity) => activity.id))]).toHaveLength(2);
    expect(emitted.activities).toEqual(retainedLatest);
    expect(listed.sessions[0]?.activityEvents).toHaveLength(40);
  });

  it("blocks unsafe terminal commands in the main process", async () => {
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({ loadNodePty: async () => nodePty as never });

    await expect(
      invoke(terminalChannels.create, {
        args: ["-rf", "/"],
        command: "rm",
        cols: 80,
        cwd: "/repo",
        rows: 24,
      }),
    ).rejects.toThrow("Terminal command blocked: rm -rf detected.");

    expect(nodePty.spawn).not.toHaveBeenCalled();
  });

  it("blocks terminal cwd values outside registered workspaces", async () => {
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({
      allowedCwdRoots: async () => ["/repo"],
      loadNodePty: async () => nodePty as never,
    });

    await expect(
      invoke(terminalChannels.create, {
        command: "node",
        cols: 80,
        cwd: "/tmp/outside",
        rows: 24,
      }),
    ).rejects.toThrow("Terminal cwd is outside registered workspaces.");

    expect(nodePty.spawn).not.toHaveBeenCalled();
  });

  it("rejects terminal cwd when allowed roots are empty", async () => {
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({
      allowedCwdRoots: async () => [],
      loadNodePty: async () => nodePty as never,
    });

    await expect(
      invoke(terminalChannels.create, {
        command: "node",
        cols: 80,
        cwd: "/private/etc",
        rows: 24,
      }),
    ).rejects.toThrow("Terminal cwd is outside registered workspaces.");

    expect(nodePty.spawn).not.toHaveBeenCalled();
  });

  it("blocks terminal cwd symlinks that resolve outside registered workspaces", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-terminal-cwd-"));
    const workspaceRoot = path.join(root, "workspace");
    const outsideRoot = path.join(root, "outside");
    const symlinkPath = path.join(workspaceRoot, "linked-outside");
    await fs.mkdir(workspaceRoot);
    await fs.mkdir(outsideRoot);
    await fs.symlink(outsideRoot, symlinkPath, "dir");
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({
      allowedCwdRoots: async () => [workspaceRoot],
      loadNodePty: async () => nodePty as never,
    });

    try {
      await expect(
        invoke(terminalChannels.create, {
          command: "node",
          cols: 80,
          cwd: symlinkPath,
          rows: 24,
        }),
      ).rejects.toThrow("Terminal cwd is outside registered workspaces.");
      expect(nodePty.spawn).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it("spawns using the canonical cwd after symlink validation", async () => {
    const fs = await import("node:fs/promises");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-terminal-cwd-"));
    const actual = path.join(root, "actual");
    const link = path.join(root, "link");
    await fs.mkdir(actual);
    await fs.symlink(actual, link, "dir");
    const canonicalLink = await fs.realpath(link);
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({
      allowedCwdRoots: async () => [root],
      loadNodePty: async () => nodePty as never,
    });

    try {
      await invoke(terminalChannels.create, {
        command: "node",
        cols: 80,
        cwd: link,
        rows: 24,
      });

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "node",
        [],
        expect.objectContaining({ cwd: canonicalLink }),
      );
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it("blocks custom renderer commands unless they are approved staged launches", async () => {
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({
      isStagedCommandAllowed: async () => false,
      loadNodePty: async () => nodePty as never,
    });

    await expect(
      invoke(terminalChannels.create, {
        command: "python3",
        args: ["-c", "print('surprise')"],
        cols: 80,
        cwd: "/repo",
        rows: 24,
        source: "manual",
      }),
    ).rejects.toThrow("Terminal command is not approved for launch.");

    expect(nodePty.spawn).not.toHaveBeenCalled();
  });

  it("prepares an exact persisted restored command and consumes its launch ticket once", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: "restored-manual",
      title: "Restored manual",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      command: "/bin/sh",
      args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
      buffer: "saved transcript\n",
    };
    configureTerminalPersistence(storeWithRestoredSessions([snapshot]), { debounceMs: 0 });
    registerTerminalIpc({
      isStagedCommandAllowed: async () => false,
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });
    const request: TerminalCreateRequest = {
      clientId: snapshot.clientId,
      command: snapshot.command,
      args: snapshot.args,
      cols: 80,
      cwd: snapshot.cwd,
      rows: 24,
      source: "manual",
    };

    const prepared = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
    await invoke(terminalChannels.create, { ...request, launchTicketId: prepared.launchTicketId });
    await expect(
      invoke(terminalChannels.create, { ...request, launchTicketId: prepared.launchTicketId }),
    ).rejects.toThrow("Terminal launch ticket is invalid or expired.");

    expect(nodePty.spawn).toHaveBeenCalledTimes(1);
    expect(nodePty.spawn).toHaveBeenCalledWith(
      snapshot.command,
      snapshot.args,
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("keeps only one concurrent prepared authorization redeemable for one restored client", async () => {
    const nodePty = fakeNodePty(new FakePty());
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: "restored-manual",
      title: "Restored manual",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      command: "/bin/sh",
      args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
      buffer: "saved transcript\n",
    };
    configureTerminalPersistence(storeWithRestoredSessions([snapshot]), { debounceMs: 0 });
    registerTerminalIpc({
      isStagedCommandAllowed: async () => false,
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });
    const request: TerminalCreateRequest = {
      clientId: snapshot.clientId,
      command: snapshot.command,
      args: snapshot.args,
      cols: 80,
      cwd: snapshot.cwd,
      rows: 24,
      source: "manual",
    };

    const [first, second] = await Promise.all([
      invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request),
      invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request),
    ]);

    const redemptions = await Promise.allSettled([
      invoke(terminalChannels.create, { ...request, launchTicketId: first.launchTicketId }),
      invoke(terminalChannels.create, { ...request, launchTicketId: second.launchTicketId }),
    ]);

    expect(redemptions.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(redemptions.find(({ status }) => status === "rejected")).toEqual(expect.objectContaining({
      reason: expect.objectContaining({ message: "Terminal launch ticket is invalid or expired." }),
    }));
    expect(nodePty.spawn).toHaveBeenCalledTimes(1);
  });

  it("rejects a restored authorization redeemed after that client becomes live", async () => {
    const loadPty = deferred<ReturnType<typeof fakeNodePty>>();
    const nodePty = fakeNodePty(new FakePty());
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: "restored-manual",
      title: "Restored manual",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      command: "/bin/sh",
      args: ["-c", "/usr/bin/printf 'confirmed restore\\n'"],
      buffer: "saved transcript\n",
    };
    configureTerminalPersistence(storeWithRestoredSessions([snapshot]), { debounceMs: 0 });
    registerTerminalIpc({
      isStagedCommandAllowed: async () => false,
      loadNodePty: async () => loadPty.promise as never,
      requireLaunchTickets: true,
    });
    const request: TerminalCreateRequest = {
      clientId: snapshot.clientId,
      command: snapshot.command,
      args: snapshot.args,
      cols: 80,
      cwd: snapshot.cwd,
      rows: 24,
      source: "manual",
    };

    const first = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
    const firstCreate = invoke(terminalChannels.create, { ...request, launchTicketId: first.launchTicketId });
    const second = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
    loadPty.resolve(nodePty);
    await firstCreate;

    await expect(
      invoke(terminalChannels.create, { ...request, launchTicketId: second.launchTicketId }),
    ).rejects.toThrow("Terminal launch ticket is invalid or expired.");
    expect(nodePty.spawn).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "command",
      request: { command: "/usr/bin/printf", args: ["persisted\\n"], clientId: "restored-manual" },
    },
    {
      name: "args",
      request: { command: "/bin/sh", args: ["-c", "/usr/bin/printf 'changed\\n'"], clientId: "restored-manual" },
    },
    {
      name: "clientId",
      request: { command: "/bin/sh", args: ["-c", "/usr/bin/printf 'persisted\\n'"], clientId: "other" },
    },
  ])("rejects a persisted restored launch with mismatched $name", async ({ request }) => {
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: "restored-manual",
      title: "Restored manual",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      command: "/bin/sh",
      args: ["-c", "/usr/bin/printf 'persisted\\n'"],
      buffer: "saved transcript\n",
    };
    const nodePty = fakeNodePty(new FakePty());
    configureTerminalPersistence(storeWithRestoredSessions([snapshot]), { debounceMs: 0 });
    registerTerminalIpc({
      isStagedCommandAllowed: async () => false,
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });

    await expect(
      invoke(terminalChannels.prepareLaunch, {
        ...request,
        cols: 80,
        cwd: "/repo",
        rows: 24,
        source: "manual",
      }),
    ).rejects.toThrow("Terminal command is not approved for launch.");
    expect(nodePty.spawn).not.toHaveBeenCalled();
  });

  it("rejects a restored-looking launch when main has no persisted snapshot", async () => {
    const nodePty = fakeNodePty(new FakePty());
    configureTerminalPersistence(storeWithRestoredSessions([]), { debounceMs: 0 });
    registerTerminalIpc({
      isStagedCommandAllowed: async () => false,
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });

    await expect(
      invoke(terminalChannels.prepareLaunch, {
        clientId: "restored-manual",
        command: "/bin/sh",
        args: ["-c", "/usr/bin/printf 'persisted\\n'"],
        cols: 80,
        cwd: "/repo",
        rows: 24,
        source: "manual",
      }),
    ).rejects.toThrow("Terminal command is not approved for launch.");
    expect(nodePty.spawn).not.toHaveBeenCalled();
  });

  it("requires a one-time launch ticket for agent commands when ticket enforcement is enabled", async () => {
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });

    await expect(
      invoke(terminalChannels.create, {
        agentKind: "codex",
        clientId: "codex-1",
        command: "codex",
        cols: 80,
        cwd: "/repo",
        rows: 24,
        source: "manual",
      }),
    ).rejects.toThrow("Terminal launch ticket is required.");

    expect(nodePty.spawn).not.toHaveBeenCalled();
  });

  it("consumes a launch ticket once and rejects mismatched cwd reuse", async () => {
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({
      allowedCwdRoots: async () => ["/repo"],
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });
    const request: TerminalCreateRequest = {
      agentKind: "codex",
      clientId: "codex-1",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      source: "manual",
    };

    const prepared = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
    await invoke(terminalChannels.create, { ...request, launchTicketId: prepared.launchTicketId });
    await expect(
      invoke(terminalChannels.create, { ...request, launchTicketId: prepared.launchTicketId }),
    ).rejects.toThrow("Terminal launch ticket is invalid or expired.");

    const second = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
    await expect(
      invoke(terminalChannels.create, { ...request, cwd: "/repo/other", launchTicketId: second.launchTicketId }),
    ).rejects.toThrow("Terminal launch ticket does not match this request.");
  });

  it("accepts launch tickets for symlinked cwd and spawns with the canonical cwd", async () => {
    const fs = await import("node:fs/promises");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-terminal-ticket-cwd-"));
    const actual = path.join(root, "actual");
    const link = path.join(root, "link");
    await fs.mkdir(actual);
    await fs.symlink(actual, link, "dir");
    const canonicalLink = await fs.realpath(link);
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({
      allowedCwdRoots: async () => [root],
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });
    const request: TerminalCreateRequest = {
      agentKind: "codex",
      clientId: "codex-link",
      command: "codex",
      cols: 80,
      cwd: link,
      rows: 24,
      source: "manual",
    };

    try {
      const prepared = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
      const created = await invoke<{ cwd: string }>(terminalChannels.create, {
        ...request,
        launchTicketId: prepared.launchTicketId,
      });

      expect(created.cwd).toBe(canonicalLink);
      expect(nodePty.spawn).toHaveBeenCalledWith(
        "codex",
        [],
        expect.objectContaining({ cwd: canonicalLink }),
      );
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it("allows custom Alfred commands only when the staged plan store approves them", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    const isStagedCommandAllowed = vi.fn(async () => true);
    registerTerminalIpc({
      isStagedCommandAllowed,
      loadNodePty: async () => nodePty as never,
    });

    await invoke(terminalChannels.create, {
      command: "pnpm",
      args: ["test"],
      clientId: "alfred-1",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      source: "alfred",
    });

    expect(isStagedCommandAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ command: "pnpm", args: ["test"], clientId: "alfred-1" }),
    );
    expect(nodePty.spawn).toHaveBeenCalledWith("pnpm", ["test"], expect.objectContaining({ cwd: "/repo" }));
  });

  it("starts scratch terminal sessions without a bound workspace cwd", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    vi.stubEnv("ALFRED_DESKTOP_WORKSPACE_CWD", "/tmp/alfred-scratch");
    registerTerminalIpc({ loadNodePty: async () => nodePty as never });
    const fs = await import("node:fs/promises");
    const expectedCwd = path.join(await fs.realpath("/tmp"), "alfred-scratch");

    const created = await invoke<{ cwd: string }>(terminalChannels.create, {
      command: "node",
      cols: 80,
      rows: 24,
    });

    expect(nodePty.spawn).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({ cols: 80, cwd: expectedCwd, rows: 24 }),
    );
    expect(created.cwd).toBe(expectedCwd);
  });

  it("uses an app-owned scratch root instead of Desktop or Home when cwd is omitted", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-terminal-scratch-"));
    const canonicalTemporaryDirectory = await fs.realpath(temporaryDirectory);
    const scratchRootPath = path.join(temporaryDirectory, "userData", "scratch");
    const expectedCanonicalCwd = path.join(canonicalTemporaryDirectory, "userData", "scratch", "alfred-A");
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    registerTerminalIpc({
      allowedCwdRoots: async () => [scratchRootPath],
      loadNodePty: async () => nodePty as never,
      scratchRootPath,
    });

    try {
      const created = await invoke<{ cwd: string }>(terminalChannels.create, {
        cols: 80,
        rows: 24,
        workspaceId: "A",
      });

      expect(created.cwd).toBe(expectedCanonicalCwd);
      expect(nodePty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ cwd: expectedCanonicalCwd }),
      );
    } finally {
      await fs.rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("creates app-owned scratch cwd before spawning an agent", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-terminal-scratch-"));
    const canonicalTemporaryDirectory = await fs.realpath(temporaryDirectory);
    const scratchRootPath = path.join(temporaryDirectory, "userData", "scratch");
    const expectedCanonicalCwd = path.join(canonicalTemporaryDirectory, "userData", "scratch", "alfred-W13");
    const pty = new FakePty();
    const nodePty = {
      spawn: vi.fn((_command: string, _args: string[], options: { cwd?: string }) => {
        expect(options.cwd).toBe(expectedCanonicalCwd);
        expect(existsSync(expectedCanonicalCwd)).toBe(true);
        return pty;
      }),
    };
    registerTerminalIpc({
      allowedCwdRoots: async () => [scratchRootPath],
      loadNodePty: async () => nodePty as never,
      scratchRootPath,
    });

    try {
      await invoke(terminalChannels.create, {
        agentKind: "codex",
        command: "codex",
        cols: 80,
        rows: 24,
        workspaceId: "W13",
      });

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "codex",
        [],
        expect.objectContaining({ cwd: expectedCanonicalCwd }),
      );
    } finally {
      await fs.rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  it("creates an isolated worktree before spawning an agent session", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    const prepareAgentWorktree = vi.fn(async () => ({
      baseCwd: "/repo",
      branchName: "alfred-codex-codex-1-20260509191530-abc123",
      cwd: "/repo/.alfred-worktrees/alfred-codex-codex-1-20260509191530-abc123",
    }));
    registerTerminalIpc({
      loadNodePty: async () => nodePty as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree,
    });

    const created = await invoke<{
      agentKind: string;
      baseCwd: string;
      branchName: string;
      cwd: string;
      isolation: string;
    }>(terminalChannels.create, {
      agentKind: "codex",
      clientId: "codex-1",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "manual",
      title: "Codex · session 1",
    });

    expect(prepareAgentWorktree).toHaveBeenCalledWith({
      agentKind: "codex",
      clientId: "codex-1",
      cwd: "/repo",
    }, {
      worktreeStoreRoot: "/alfred/userData/worktrees",
    });
    expect(nodePty.spawn).toHaveBeenCalledWith(
      "codex",
      [],
      expect.objectContaining({
        cwd: "/repo/.alfred-worktrees/alfred-codex-codex-1-20260509191530-abc123",
      }),
    );
    expect(created).toMatchObject({
      agentKind: "codex",
      baseCwd: "/repo",
      branchName: "alfred-codex-codex-1-20260509191530-abc123",
      cwd: "/repo/.alfred-worktrees/alfred-codex-codex-1-20260509191530-abc123",
      isolation: "worktree",
    });
  });

  it("reuses an existing isolated checkout when launch metadata is present", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    const prepareAgentWorktree = vi.fn();
    registerTerminalIpc({
      loadNodePty: async () => nodePty as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree,
    });

    const created = await invoke<{
      agentKind: string;
      baseCwd: string;
      branchName: string;
      cwd: string;
      isolation: string;
    }>(terminalChannels.create, {
      agentKind: "codex",
      baseCwd: "/repo",
      branchName: "alfred-codex-review",
      clientId: "codex-1",
      command: "codex",
      cols: 80,
      cwd: "/.alfred-worktrees/repo/alfred-codex-review/packages/app",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      title: "Codex review",
    });

    expect(prepareAgentWorktree).not.toHaveBeenCalled();
    expect(nodePty.spawn).toHaveBeenCalledWith(
      "codex",
      [],
      expect.objectContaining({ cwd: "/.alfred-worktrees/repo/alfred-codex-review/packages/app" }),
    );
    expect(created).toMatchObject({
      agentKind: "codex",
      baseCwd: "/repo",
      branchName: "alfred-codex-review",
      cwd: "/.alfred-worktrees/repo/alfred-codex-review/packages/app",
      isolation: "worktree",
    });
  });

  it("launches non-coding worktree requests in the shared cwd without preparing a worktree", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    const prepareAgentWorktree = vi.fn(async () => ({
      baseCwd: "/repo",
      branchName: "alfred-dev-server",
      cwd: "/repo/.alfred-worktrees/alfred-dev-server",
    }));
    registerTerminalIpc({
      loadNodePty: async () => nodePty as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree,
    });

    const created = await invoke<{
      agentKind: string;
      cwd: string;
      isolation: string;
    }>(terminalChannels.create, {
      agentKind: "dev-server",
      clientId: "dev-1",
      command: "pnpm",
      args: ["dev"],
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      title: "Dev server",
    });

    expect(prepareAgentWorktree).not.toHaveBeenCalled();
    expect(nodePty.spawn).toHaveBeenCalledWith(
      "pnpm",
      ["dev"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(created).toMatchObject({
      agentKind: "dev-server",
      cwd: "/repo",
      isolation: "shared",
    });
    expect(created).not.toHaveProperty("branchName");
    expect(created).not.toHaveProperty("baseCwd");
  });

  it("launches worktree requests without an agent kind in the shared cwd without preparing a worktree", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    const prepareAgentWorktree = vi.fn();
    registerTerminalIpc({
      loadNodePty: async () => nodePty as never,
      prepareAgentWorktree,
    });

    const created = await invoke<{
      cwd: string;
      isolation: string;
    }>(terminalChannels.create, {
      clientId: "manual-1",
      command: "node",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "manual",
      title: "Manual terminal",
    });

    expect(prepareAgentWorktree).not.toHaveBeenCalled();
    expect(nodePty.spawn).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({ cwd: "/repo" }),
    );
    expect(created).toMatchObject({
      cwd: "/repo",
      isolation: "shared",
    });
    expect(created).not.toHaveProperty("branchName");
    expect(created).not.toHaveProperty("baseCwd");
  });

  it("cleans the isolated worktree when a live agent session is forgotten", async () => {
    const pty = new FakePty();
    const cleanupAgentWorktree = vi.fn(async (_request: AgentWorktreeCleanupRequest): Promise<void> => undefined);
    const prepareAgentWorktree = vi.fn(async () => ({
      baseCwd: "/repo",
      branchName: "alfred-codex-review",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-review",
    }));
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree,
    });

    const created = await invoke<{ id: string }>(terminalChannels.create, {
      agentKind: "codex",
      clientId: "codex-1",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      title: "Codex review",
    });

    emit(terminalChannels.kill, { id: created.id, cleanupWorktree: true });

    expect(cleanupAgentWorktree).toHaveBeenCalledWith({
      baseCwd: "/repo",
      branchName: "alfred-codex-review",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-review",
      force: true,
    }, {
      worktreeStoreRoot: "/alfred/userData/worktrees",
    });
  });

  it("cleans the isolated worktree when a restored agent session is forgotten", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "codex-1",
          title: "Codex review",
          source: "alfred",
          agentKind: "codex",
          cwd: "/.alfred-worktrees/repo/alfred-codex-review",
          isolation: "worktree",
          branchName: "alfred-codex-review",
          baseCwd: "/repo",
          createdAt: 1,
          shell: "codex",
          command: "codex",
          buffer: "done",
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const cleanupAgentWorktree = vi.fn(async (_request: AgentWorktreeCleanupRequest): Promise<void> => undefined);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    await invoke<TerminalListResult>(terminalChannels.list);
    emit(terminalChannels.forget, { clientId: "codex-1", cleanupWorktree: true });

    expect(cleanupAgentWorktree).toHaveBeenCalledWith({
      baseCwd: "/repo",
      branchName: "alfred-codex-review",
      cwd: "/.alfred-worktrees/repo/alfred-codex-review",
      force: true,
    }, {
      worktreeStoreRoot: "/alfred/userData/worktrees",
    });
  });

  it("cleans legacy restored worktrees that predate persisted isolation metadata", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "codex-legacy",
          title: "Codex legacy",
          source: "alfred",
          agentKind: "codex",
          cwd: "/.alfred-worktrees/repo/alfred-codex-legacy",
          branchName: "alfred-codex-legacy",
          baseCwd: "/repo",
          createdAt: 1,
          shell: "codex",
          command: "codex",
          buffer: "done",
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const cleanupAgentWorktree = vi.fn(async (_request: AgentWorktreeCleanupRequest): Promise<void> => undefined);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    await invoke<TerminalListResult>(terminalChannels.list);
    emit(terminalChannels.forget, { clientId: "codex-legacy", cleanupWorktree: true });

    expect(cleanupAgentWorktree).toHaveBeenCalledWith({
      baseCwd: "/repo",
      branchName: "alfred-codex-legacy",
      cwd: "/.alfred-worktrees/repo/alfred-codex-legacy",
      force: true,
    }, {
      worktreeStoreRoot: "/alfred/userData/worktrees",
    });
  });

  it("does not clean explicitly shared restored sessions even if stale worktree metadata exists", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "codex-shared",
          title: "Codex shared",
          source: "alfred",
          agentKind: "codex",
          cwd: "/repo",
          isolation: "shared",
          branchName: "alfred-codex-stale",
          baseCwd: "/repo",
          createdAt: 1,
          shell: "codex",
          command: "codex",
          buffer: "done",
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const cleanupAgentWorktree = vi.fn(async (_request: AgentWorktreeCleanupRequest): Promise<void> => undefined);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    await invoke<TerminalListResult>(terminalChannels.list);
    emit(terminalChannels.forget, { clientId: "codex-shared", cleanupWorktree: true });

    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
  });

  it("returns a diff summary for a live isolated checkout", async () => {
    const pty = new FakePty();
    const inspectAgentWorktree = vi.fn(async () => ({
      summary: "2 changed files",
      files: [
        { path: "src/app.tsx", status: "M" },
        { path: "notes/review.md", status: "??" },
      ],
    }));
    const prepareAgentWorktree = vi.fn(async () => ({
      baseCwd: "/repo",
      branchName: "alfred-codex-review",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-review",
    }));
    registerTerminalIpc({
      inspectAgentWorktree,
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree,
    });

    await invoke(terminalChannels.create, {
      agentKind: "codex",
      clientId: "codex-1",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      title: "Codex review",
    });

    const result = await invoke(terminalChannels.worktreeDiff, { clientId: "codex-1" });

    expect(result).toEqual({
      ok: true,
      summary: "2 changed files",
      files: [
        { path: "src/app.tsx", status: "M" },
        { path: "notes/review.md", status: "??" },
      ],
    });
    expect(inspectAgentWorktree).toHaveBeenCalledWith({
      baseCwd: "/repo",
      branchName: "alfred-codex-review",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-review",
    }, {
      worktreeStoreRoot: "/alfred/userData/worktrees",
    });
  });

  it("applies a legacy restored checkout by client id even without persisted isolation", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "codex-1",
          title: "Codex review",
          source: "alfred",
          agentKind: "codex",
          cwd: "/.alfred-worktrees/repo/alfred-codex-review",
          branchName: "alfred-codex-review",
          baseCwd: "/repo",
          createdAt: 1,
          shell: "codex",
          command: "codex",
          buffer: "done",
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const applyAgentWorktreePatch = vi.fn(async () => ({ appliedFiles: 3 }));
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      applyAgentWorktreePatch,
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    const result = await invoke(terminalChannels.worktreeApply, { clientId: "codex-1" });

    expect(result).toEqual({ ok: true, appliedFiles: 3 });
    expect(applyAgentWorktreePatch).toHaveBeenCalledWith({
      baseCwd: "/repo",
      branchName: "alfred-codex-review",
      cwd: "/.alfred-worktrees/repo/alfred-codex-review",
    }, {
      worktreeStoreRoot: "/alfred/userData/worktrees",
    });
  });

  it("does not apply shared sessions as isolated checkouts", async () => {
    const pty = new FakePty();
    const applyAgentWorktreePatch = vi.fn(async () => ({ appliedFiles: 1 }));
    registerTerminalIpc({
      applyAgentWorktreePatch,
      loadNodePty: async () => fakeNodePty(pty) as never,
    });

    await invoke(terminalChannels.create, {
      agentKind: "codex",
      clientId: "codex-1",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "shared",
      rows: 24,
      source: "manual",
      title: "Codex shared",
    });

    const result = await invoke(terminalChannels.worktreeApply, { clientId: "codex-1" });

    expect(result).toEqual({
      ok: false,
      error: "Session is not an isolated checkout.",
      needsManualReview: true,
    });
    expect(applyAgentWorktreePatch).not.toHaveBeenCalled();
  });

  it("does not apply explicitly shared restored sessions with stale worktree metadata", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "codex-shared",
          title: "Codex shared",
          source: "alfred",
          agentKind: "codex",
          cwd: "/repo",
          isolation: "shared",
          branchName: "alfred-codex-stale",
          baseCwd: "/repo",
          createdAt: 1,
          shell: "codex",
          command: "codex",
          buffer: "done",
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const applyAgentWorktreePatch = vi.fn(async () => ({ appliedFiles: 1 }));
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      applyAgentWorktreePatch,
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    const result = await invoke(terminalChannels.worktreeApply, { clientId: "codex-shared" });

    expect(result).toEqual({
      ok: false,
      error: "Session is not an isolated checkout.",
      needsManualReview: true,
    });
    expect(applyAgentWorktreePatch).not.toHaveBeenCalled();
  });

  it("rejects unsafe isolated checkout metadata before apply", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "codex-1",
          title: "Codex review",
          source: "alfred",
          agentKind: "codex",
          cwd: "/alfred/userData/worktrees/alfred-12345678/../escape",
          isolation: "worktree",
          branchName: "../escape",
          baseCwd: "/repo",
          createdAt: 1,
          shell: "codex",
          command: "codex",
          buffer: "done",
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const applyAgentWorktreePatch = vi.fn(async () => ({ appliedFiles: 1 }));
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      applyAgentWorktreePatch,
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    const result = await invoke(terminalChannels.worktreeApply, { clientId: "codex-1" });

    expect(result).toEqual({
      ok: false,
      error: "Isolated checkout metadata is not safe.",
      needsManualReview: true,
    });
    expect(applyAgentWorktreePatch).not.toHaveBeenCalled();
  });

  it("does not clean restored worktrees with unsafe traversal metadata", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "codex-1",
          title: "Codex review",
          source: "alfred",
          agentKind: "codex",
          cwd: "/alfred/userData/worktrees/alfred-12345678/../escape",
          isolation: "worktree",
          branchName: "../escape",
          baseCwd: "/repo",
          createdAt: 1,
          shell: "codex",
          command: "codex",
          buffer: "done",
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      getState: vi.fn(async () => state),
      setState: vi.fn(async (next) => {
        state = next;
        return state;
      }),
      updateState: vi.fn(async (updater) => {
        state = await updater(state);
        return state;
      }),
    };
    const cleanupAgentWorktree = vi.fn(async (_request: AgentWorktreeCleanupRequest): Promise<void> => undefined);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    await invoke<TerminalListResult>(terminalChannels.list);
    emit(terminalChannels.forget, { clientId: "codex-1", cleanupWorktree: true });

    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
  });

  it("normalizes stale Alfred prompt flags before spawning agent sessions", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    registerTerminalIpc({
      loadNodePty: async () => nodePty as never,
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-review",
        cwd: "/repo/.alfred-worktrees/alfred-codex-review",
      }),
    });

    const created = await invoke<{ args: string[] }>(terminalChannels.create, {
      agentKind: "codex",
      clientId: "alfred-1",
      command: "codex",
      args: ["--prompt", "Review the backend"],
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      title: "Codex review",
    });

    expect(nodePty.spawn).toHaveBeenCalledWith(
      "codex",
      ["Review the backend"],
      expect.objectContaining({ cwd: "/repo/.alfred-worktrees/alfred-codex-review" }),
    );
    expect(created.args).toEqual(["Review the backend"]);
  });

  it("does not spawn a session when isolated worktree preparation fails", async () => {
    const nodePty = fakeNodePty(new FakePty());
    const prepareAgentWorktree = vi.fn(async () => {
      throw new Error("Workspace has uncommitted changes.");
    });
    registerTerminalIpc({
      loadNodePty: async () => nodePty as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree,
    });

    await expect(
      invoke(terminalChannels.create, {
        agentKind: "codex",
        clientId: "codex-1",
        command: "codex",
        cols: 80,
        cwd: "/repo",
        isolation: "worktree",
        rows: 24,
        source: "manual",
        title: "Codex · session 1",
      }),
    ).rejects.toThrow("Workspace has uncommitted changes.");

    expect(prepareAgentWorktree).toHaveBeenCalledOnce();
    expect(nodePty.spawn).not.toHaveBeenCalled();
    expect(getTerminalSessionCount()).toBe(0);
  });

  it("uses a preflighted branch name for isolated staged sessions", async () => {
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    const prepareAgentWorktree = vi.fn(async () => ({
      baseCwd: "/repo",
      branchName: "alfred-codex-preflight",
      cwd: "/repo/.alfred-worktrees/alfred-codex-preflight",
    }));
    registerTerminalIpc({
      loadNodePty: async () => nodePty as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree,
    });

    await invoke(terminalChannels.create, {
      agentKind: "codex",
      branchName: "alfred-codex-preflight",
      clientId: "alfred-1",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      title: "Codex plan",
    });

    expect(prepareAgentWorktree).toHaveBeenCalledWith({
      agentKind: "codex",
      branchName: "alfred-codex-preflight",
      clientId: "alfred-1",
      cwd: "/repo",
    }, {
      worktreeStoreRoot: "/alfred/userData/worktrees",
    });
  });

  it("supports write, resize, kill, and session count", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    const created = await invoke<{ id: string }>(terminalChannels.create, {
      command: "node",
      cols: 80,
      cwd: "/repo",
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

  it("returns a fresh owned terminal snapshot for renderer reattach", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    const created = await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "manual-snapshot",
      cwd: "/repo",
      cols: 80,
      rows: 24,
      command: "zsh",
    });

    pty.onDataHandler?.("fresh output after unmount\n");

    const snapshot = await invoke<TerminalSnapshotResult>(terminalChannels.snapshot, { id: created.id });

    expect(snapshot?.id).toBe(created.id);
    expect(snapshot?.buffer).toBe("fresh output after unmount\n");
    expect(snapshot?.clientId).toBe("manual-snapshot");
  });

  it("does not return snapshots to a window that does not own the terminal", async () => {
    const ownerWindow = fakeWindow(1);
    const otherWindow = fakeWindow(999);
    liveWindows = [ownerWindow, otherWindow];
    const ownerSender = senderFor(ownerWindow);
    const otherSender = senderFor(otherWindow);
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    const created = await invoke<{ id: string }>(
      terminalChannels.create,
      {
        clientId: "manual-owned",
        cwd: "/repo",
        cols: 80,
        rows: 24,
        command: "zsh",
      },
      ownerSender,
    );

    const snapshot = await invoke<TerminalSnapshotResult>(terminalChannels.snapshot, { id: created.id }, otherSender);

    expect(snapshot).toBeNull();
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
      { command: "node", cols: 80, cwd: "/repo", rows: 24 },
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

  it("rejects live isolated checkout operations from a different window even when a snapshot exists", async () => {
    const ownerWindow = fakeWindow(1);
    const otherWindow = fakeWindow(2);
    liveWindows = [ownerWindow, otherWindow];
    const ownerSender = senderFor(ownerWindow);
    const otherSender = senderFor(otherWindow);
    const pty = new FakePty();
    const inspectAgentWorktree = vi.fn(async () => ({ summary: "1 changed file", files: [] }));
    const applyAgentWorktreePatch = vi.fn(async () => ({ appliedFiles: 1 }));
    registerTerminalIpc({
      applyAgentWorktreePatch,
      inspectAgentWorktree,
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-review",
        cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-review",
      }),
    });

    await invoke(
      terminalChannels.create,
      {
        agentKind: "codex",
        clientId: "codex-1",
        command: "codex",
        cols: 80,
        cwd: "/repo",
        isolation: "worktree",
        rows: 24,
        source: "alfred",
        title: "Codex review",
      },
      ownerSender,
    );
    pty.onDataHandler?.("snapshot exists\n");

    const diff = await invoke(terminalChannels.worktreeDiff, { clientId: "codex-1" }, otherSender);
    const apply = await invoke(terminalChannels.worktreeApply, { clientId: "codex-1" }, otherSender);

    expect(diff).toEqual({ ok: false, error: "Session not found." });
    expect(apply).toEqual({ ok: false, error: "Session not found.", needsManualReview: true });
    expect(inspectAgentWorktree).not.toHaveBeenCalled();
    expect(applyAgentWorktreePatch).not.toHaveBeenCalled();
  });

  it("does not let another window forget or clean a live isolated checkout by client id", async () => {
    const ownerWindow = fakeWindow(1);
    const otherWindow = fakeWindow(2);
    liveWindows = [ownerWindow, otherWindow];
    const ownerSender = senderFor(ownerWindow);
    const otherSender = senderFor(otherWindow);
    const pty = new FakePty();
    const cleanupAgentWorktree = vi.fn(async (_request: AgentWorktreeCleanupRequest): Promise<void> => undefined);
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-review",
        cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-review",
      }),
    });

    await invoke(
      terminalChannels.create,
      {
        agentKind: "codex",
        clientId: "codex-1",
        command: "codex",
        cols: 80,
        cwd: "/repo",
        isolation: "worktree",
        rows: 24,
        source: "alfred",
        title: "Codex review",
      },
      ownerSender,
    );
    pty.onDataHandler?.("snapshot exists\n");

    emit(terminalChannels.forget, { clientId: "codex-1", cleanupWorktree: true }, otherSender);

    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
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
      { command: "node", cols: 80, cwd: "/repo", rows: 24 },
      oldSender,
    );
    liveWindows = [newWindow];
    const listed = await invoke<{ sessions: Array<{ id: string }> }>(terminalChannels.list, undefined, newSender);
    pty.onDataHandler?.("after reattach\n");
    emit(terminalChannels.write, { id: created.id, data: "ok\r" }, newSender);

    expect(listed.sessions).toEqual([expect.objectContaining({ id: created.id })]);
    expect(sentEvents).toContainEqual({
      channel: terminalChannels.data,
      payload: { id: created.id, data: "after reattach\n", activities: [] },
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
