import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { BrowserWindow, ipcMain } from "electron";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  applyTerminalPrivacyPolicyInMemory,
  configureTerminalPersistence,
  flushTerminalPersistence,
  getTerminalSessionCount,
  killAllTerminalSessions,
  registerTerminalIpc as registerTerminalIpcBase,
  resetTerminalPersistenceForTests,
  savesTerminalData,
  waitForTerminalExits,
} from "./terminal-manager.js";
import type { SessionActivityInput } from "../shared/session-activity.js";
import { CODEX_NOTIFICATION_ARGS } from "./agent-signals.js";
import { terminalChannels } from "../shared/terminal-ipc.js";
import type {
  PersistedTerminalSessionSnapshot,
  TerminalCreateResult,
  TerminalCreateRequest,
  TerminalDataEvent,
  TerminalWorkerRequest,
  TerminalListResult,
} from "../shared/terminal-ipc.js";
import type { TerminalSnapshotResult } from "../shared/terminal-ipc.js";
import {
  managedProjectWorktreeRoot,
  workspaceRootFingerprint,
  type AgentWorktreeCleanupRequest,
} from "./git-worktree.js";
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
  process = "zsh";
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
    getAppPath: () => "/Users/sample/Desktop/Alfred/apps/desktop",
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

function persistedStateStoreMethods(getState: () => DesktopStateSnapshot): Pick<
  PersistedDesktopStateStore,
  "getFilePath" | "getSaveStatus" | "onSaveStatus" | "retrySave"
> {
  return {
    getFilePath: vi.fn(() => "/test/desktop-state.json"),
    getSaveStatus: vi.fn(() => ({ status: "saved" as const })),
    onSaveStatus: vi.fn(() => () => {}),
    retrySave: vi.fn(async () => getState()),
  };
}

function storeWithRestoredSessions(
  restoredTerminalSessions: PersistedTerminalSessionSnapshot[],
): PersistedDesktopStateStore {
  let state = stateWithRestoredSessions(restoredTerminalSessions);
  return {
    ...persistedStateStoreMethods(() => state),
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

function staleHydrationSessions(prefix: string): PersistedTerminalSessionSnapshot[] {
  return [
    {
      clientId: `${prefix}-shared`,
      title: "Stale shared",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      command: "node",
      args: ["stale-secret"],
      buffer: "stale output",
    },
    {
      clientId: `${prefix}-isolated`,
      title: "Stale isolated",
      source: "alfred",
      agentKind: "codex",
      workspaceId: "workspace-a",
      isolation: "worktree",
      branchName: `alfred-codex-${prefix}-isolated`,
      baseCwd: "/repo",
      cwd: `/alfred/userData/worktrees/${prefix}-isolated`,
      shell: "codex",
      command: "codex",
      args: ["stale-secret"],
      buffer: "stale output",
    },
  ];
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

vi.mock("./trusted-ipc.js", async () => {
  const { ipcMain } = await import("electron");
  return { trustedIpc: ipcMain, isTrustedIpcRecipient: () => true };
});

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
      ...persistedStateStoreMethods(() => state),
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
        activityEvents: expect.arrayContaining([
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
          expect.objectContaining({
            kind: "lifecycle",
            title: "Stopped on quit",
          }),
        ]),
      }),
    ]);
  });

  it("keeps the parent a worker was started under and drops one that is not a client id", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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

    const worker = await invoke<{ parentClientId?: string }>(terminalChannels.create, {
      clientId: "manual-2", cols: 80, cwd: "/repo", rows: 24, parentClientId: "codex-1",
    });
    await invoke(terminalChannels.create, { clientId: "manual-3", cols: 80, cwd: "/repo", rows: 24, parentClientId: "../x y" });
    await invoke(terminalChannels.create, { clientId: "manual-4", cols: 80, cwd: "/repo", rows: 24, parentClientId: 7 });
    await flushTerminalPersistence();

    expect(worker.parentClientId).toBe("codex-1");
    const listed = await invoke<{ sessions: Array<{ clientId?: string; parentClientId?: string }> }>(terminalChannels.list);
    expect(listed.sessions.map((session) => [session.clientId, session.parentClientId])).toEqual([
      ["manual-2", "codex-1"],
      ["manual-3", undefined],
      ["manual-4", undefined],
    ]);
    expect(state.restoredTerminalSessions.map((session) => [session.clientId, session.parentClientId])).toEqual([
      ["manual-2", "codex-1"],
      ["manual-3", undefined],
      ["manual-4", undefined],
    ]);
  });

  it("handles a rejected background terminal persistence write", async () => {
    const rejection = new Error("disk unavailable");
    const store = storeWithRestoredSessions([]);
    vi.mocked(store.updateState).mockRejectedValue(rejection);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(new FakePty()) as never });

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await invoke(terminalChannels.create, {
        clientId: "manual-persistence-failure",
        command: "node",
        cols: 80,
        cwd: "/repo",
        rows: 24,
        title: "Manual terminal",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(
        "Failed to persist terminal snapshots in background.",
        rejection,
      );
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("limits persisted terminal scrollback to the latest 80,000 characters", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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

  const keyLines = Array.from({ length: 25 }, () => "K".repeat(70));
  it.each([
    { name: "a token", secret: `ghp_${"S".repeat(36)}`, cutInto: 2, body: "S".repeat(36) },
    {
      name: "a private key",
      secret: ["-----BEGIN OPENSSH PRIVATE KEY-----", ...keyLines, "-----END OPENSSH PRIVATE KEY-----"].join("\n"),
      cutInto: 10,
      body: keyLines[0]!,
    },
  ])("redacts $name that the saved tail cuts through", async ({ secret, cutInto, body }) => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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
      clientId: "manual-secret-tail",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      title: "Manual terminal",
    });

    // The 80k tail starts `cutInto` characters into the secret, past "gh" or into the key's BEGIN line.
    pty.onDataHandler?.(`${"a".repeat(1_000)}\n${secret}\n${"b".repeat(80_000 - secret.length - 1 + cutInto)}`);
    await flushTerminalPersistence();

    const saved = state.restoredTerminalSessions[0]?.buffer ?? "";
    expect(saved.length).toBeLessThanOrEqual(80_000);
    expect(saved).not.toContain(body);
  });

  it("redacts persisted terminal scrollback and activity", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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
      title: "Manual /Users/sample/Desktop/Alfred",
    });
    pty.onDataHandler?.("Authorization: Bearer abc.def.ghi\nBash(\"echo sk-proj-1234567890abcdef\")\n");
    await flushTerminalPersistence();

    const session = state.restoredTerminalSessions[0];
    expect(session?.title).toBe("Manual [redacted-path:cd97628a]");
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
    const rawBuffer = "/Users/sample/project\nsecret=abc123def4567890\n";
    const rawTitle = "/Users/sample/project";
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      restoredTerminalSessions: [
        {
          clientId: "manual-sensitive-restore",
          title: rawTitle,
          source: "manual",
          cwd: "/Users/sample/project",
          createdAt: 1,
          shell: "/bin/zsh",
          buffer: rawBuffer,
        },
      ],
    };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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
    const restored = listed.restoredSessions?.[0];
    expect(restored?.title).toBe(rawTitle);
    expect(restored?.buffer).toBe(rawBuffer);
  });

  it("drops shared persisted terminal sessions when retention is off", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      privacySettings: {
        ...DEFAULT_DESKTOP_STATE.privacySettings,
        terminalScrollbackRetention: "off",
      },
      restoredTerminalSessions: [],
    };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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

    expect(state.restoredTerminalSessions).toEqual([]);
  });

  it("applies retention off immediately without killing live terminals or permanently disabling new runtimes", async () => {
    const sharedRestored: PersistedTerminalSessionSnapshot = {
      clientId: "shared-restored",
      title: "Shared restored",
      source: "manual",
      cwd: "/repo",
      baseCwd: "/repo",
      shell: "/bin/zsh",
      command: "node",
      args: ["shared-secret"],
      buffer: "shared old buffer",
      lastActivityAt: 10,
      lastOutputAt: 11,
    };
    const isolatedRestored: PersistedTerminalSessionSnapshot = {
      clientId: "isolated-restored",
      title: "Isolated restored",
      source: "alfred",
      agentKind: "codex",
      workspaceId: "workspace-a",
      isolation: "worktree",
      branchName: "alfred-codex-restored",
      baseCwd: "/repo",
      cwd: "/alfred/userData/worktrees/restored",
      shell: "codex",
      command: "codex",
      args: ["resume", "isolated-secret"],
      resumeTarget: {
        agentKind: "codex",
        sessionId: "isolated-secret",
        source: "codex-session-index",
      },
      buffer: "isolated old buffer",
      lastActivityAt: 12,
      lastOutputAt: 13,
    };
    let state = stateWithRestoredSessions([sharedRestored, isolatedRestored]);
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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
    const oldPty = new FakePty();
    const newPty = new FakePty();
    const ptys = [oldPty, newPty];
    const prepareAgentWorktree = vi.fn(async (request: import("./git-worktree.js").AgentWorktreeRequest) => ({
      baseCwd: "/repo",
      branchName: `alfred-codex-${request.clientId}`,
      cwd: `/alfred/userData/worktrees/${request.clientId}`,
    }));
    configureTerminalPersistence(store, { debounceMs: 60_000 });
    registerTerminalIpc({
      loadNodePty: async () => fakeNodePty(ptys.shift() ?? new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree,
    });

    await invoke<TerminalListResult>(terminalChannels.list);
    const oldRuntime = await invoke<{ id: string; workspaceRootFingerprint?: string }>(terminalChannels.create, {
      agentKind: "codex",
      args: ["resume", "live-secret"],
      clientId: "live-runtime",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      resumeTarget: {
        agentKind: "codex",
        sessionId: "live-secret",
        source: "codex-session-index",
      },
      rows: 24,
      source: "alfred",
      title: "Live runtime",
      workspaceId: "workspace-a",
    });
    oldPty.onDataHandler?.("old live buffer\nBash(\"old-secret\")\n");

    state = {
      ...state,
      privacySettings: {
        terminalScrollbackRetention: "off",
      },
    };
    const cleared = applyTerminalPrivacyPolicyInMemory(state.privacySettings);
    const immediateList = await invoke<TerminalListResult>(terminalChannels.list);

    expect(immediateList.restoredSessions?.map(({ clientId }) => clientId)).toEqual(["isolated-restored"]);
    expect(immediateList.restoredSessions?.[0]).not.toHaveProperty("command");
    expect(immediateList.sessions).toHaveLength(1);
    expect(cleared).toBe(3);
    expect(oldPty.killed).toBe(false);
    expect(oldRuntime.workspaceRootFingerprint).toMatch(/^[a-f0-9]{16}$/);

    state = {
      ...state,
      privacySettings: {
        terminalScrollbackRetention: "redactedTail",
      },
    };
    applyTerminalPrivacyPolicyInMemory(state.privacySettings);
    oldPty.onDataHandler?.("fresh output\n");
    await flushTerminalPersistence();

    expect(state.restoredTerminalSessions.find(({ clientId }) => clientId === "shared-restored")).toBeUndefined();
    expect(state.restoredTerminalSessions.find(({ clientId }) => clientId === "isolated-restored")).toEqual({
      clientId: "isolated-restored",
      title: "Isolated restored",
      source: "alfred",
      agentKind: "codex",
      workspaceId: "workspace-a",
      workspaceRootFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
      isolation: "worktree",
      branchName: "alfred-codex-restored",
    });
    const oldRuntimePersisted = state.restoredTerminalSessions.find(({ clientId }) => clientId === "live-runtime");
    expect(oldRuntimePersisted?.buffer).toBe("fresh output\n");
    expect(JSON.stringify(oldRuntimePersisted)).not.toContain("old");
    for (const field of ["cwd", "baseCwd", "shell", "command", "args", "resumeTarget", "activityEvents"]) {
      expect(oldRuntimePersisted).not.toHaveProperty(field);
    }

    const newRuntime = await invoke<{ id: string; workspaceRootFingerprint?: string }>(terminalChannels.create, {
      agentKind: "codex",
      args: ["new-safe-arg"],
      clientId: "new-runtime",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      title: "New runtime",
      workspaceId: "workspace-a",
    });
    newPty.onDataHandler?.("new runtime output\n");
    await flushTerminalPersistence();

    expect(oldPty.killed).toBe(false);
    expect(newRuntime.workspaceRootFingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(state.restoredTerminalSessions.find(({ clientId }) => clientId === "new-runtime")).toEqual(
      expect.objectContaining({
        args: ["new-safe-arg"],
        baseCwd: "/repo",
        command: "codex",
        cwd: "/alfred/userData/worktrees/new-runtime",
        shell: "codex",
      }),
    );
  });

  it("does not persist launch data or output produced by a runtime created while retention is off", async () => {
    let state: DesktopStateSnapshot = {
      ...DEFAULT_DESKTOP_STATE,
      privacySettings: {
        terminalScrollbackRetention: "off",
      },
      restoredTerminalSessions: [],
    };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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
    registerTerminalIpc({
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-created-off",
        cwd: "/alfred/userData/worktrees/created-off",
      }),
    });

    await invoke(terminalChannels.create, {
      agentKind: "codex",
      args: ["off-secret-arg"],
      clientId: "created-off",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      workspaceId: "workspace-a",
    });
    pty.onDataHandler?.("off-secret-output\nBash(\"off-secret-activity\")\n");
    state = { ...state, privacySettings: DEFAULT_DESKTOP_STATE.privacySettings };
    applyTerminalPrivacyPolicyInMemory(state.privacySettings);
    await flushTerminalPersistence();

    const persisted = state.restoredTerminalSessions.find(({ clientId }) => clientId === "created-off");
    expect(JSON.stringify(persisted)).not.toContain("off-secret");
    for (const field of ["cwd", "baseCwd", "shell", "command", "args", "resumeTarget", "activityEvents"]) {
      expect(persisted).not.toHaveProperty(field);
    }
    expect(pty.killed).toBe(false);
  });

  it("keeps launch persistence disabled when terminal creation crosses Clear", async () => {
    let state = stateWithRestoredSessions([]);
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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
    const pendingPty = deferred<ReturnType<typeof fakeNodePty>>();
    const pty = new FakePty();
    const loadNodePty = vi.fn(async () => pendingPty.promise as never);
    configureTerminalPersistence(store, { debounceMs: 60_000 });
    registerTerminalIpc({
      loadNodePty,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-cross-clear",
        cwd: "/alfred/userData/worktrees/cross-clear",
      }),
    });

    const creating = invoke(terminalChannels.create, {
      agentKind: "codex",
      args: ["cross-clear-secret"],
      clientId: "cross-clear",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      workspaceId: "workspace-a",
    });
    await vi.waitFor(() => expect(loadNodePty).toHaveBeenCalledOnce());
    applyTerminalPrivacyPolicyInMemory(state.privacySettings, true);
    pendingPty.resolve(fakeNodePty(pty));
    await creating;
    pty.onDataHandler?.("fresh output\n");
    await flushTerminalPersistence();

    const persisted = state.restoredTerminalSessions.find(({ clientId }) => clientId === "cross-clear");
    expect(JSON.stringify(persisted)).not.toContain("cross-clear-secret");
    for (const field of ["cwd", "baseCwd", "shell", "command", "args", "resumeTarget"]) {
      expect(persisted).not.toHaveProperty(field);
    }
    expect(pty.killed).toBe(false);
  });

  it("sanitizes stale restored snapshots when hydration resolves after retention is disabled", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    const store = storeWithRestoredSessions([]);
    vi.mocked(store.getState).mockReturnValue(hydration.promise);
    configureTerminalPersistence(store, { debounceMs: 60_000 });
    registerTerminalIpc();

    const pendingList = invoke<TerminalListResult>(terminalChannels.list);
    applyTerminalPrivacyPolicyInMemory({
      terminalScrollbackRetention: "off",
    });
    hydration.resolve(stateWithRestoredSessions([
      {
        clientId: "stale-shared",
        title: "Stale shared",
        source: "manual",
        cwd: "/repo",
        shell: "/bin/zsh",
        command: "node",
        args: ["stale-secret"],
        buffer: "stale output",
      },
      {
        clientId: "stale-isolated",
        title: "Stale isolated",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "workspace-a",
        isolation: "worktree",
        branchName: "alfred-codex-stale-isolated",
        baseCwd: "/repo",
        cwd: "/alfred/userData/worktrees/stale-isolated",
        shell: "codex",
        command: "codex",
        args: ["stale-secret"],
        buffer: "stale output",
      },
    ]));

    const listed = await pendingList;
    expect(listed.restoredSessions).toEqual([
      {
        clientId: "stale-isolated",
        title: "Stale isolated",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "workspace-a",
        workspaceRootFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
        isolation: "worktree",
        branchName: "alfred-codex-stale-isolated",
      },
    ]);
  });

  it("keeps explicit Off authoritative when later hydration returns stale redactedTail data", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    let state = stateWithRestoredSessions([]);
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
      getState: vi.fn(() => hydration.promise),
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
    registerTerminalIpc({
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-after-explicit-off",
        cwd: "/alfred/userData/worktrees/after-explicit-off",
      }),
    });
    applyTerminalPrivacyPolicyInMemory({
      terminalScrollbackRetention: "off",
    });

    const pendingList = invoke<TerminalListResult>(terminalChannels.list);
    hydration.resolve(stateWithRestoredSessions(staleHydrationSessions("after-off")));
    const listed = await pendingList;

    expect(listed.restoredSessions?.map(({ clientId }) => clientId)).toEqual(["after-off-isolated"]);
    expect(listed.restoredSessions?.[0]).not.toHaveProperty("command");

    await invoke(terminalChannels.create, {
      agentKind: "codex",
      args: ["future-off-secret"],
      clientId: "after-explicit-off",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      workspaceId: "workspace-a",
    });
    pty.onDataHandler?.("future-off-output\n");
    state = { ...state, privacySettings: DEFAULT_DESKTOP_STATE.privacySettings };
    applyTerminalPrivacyPolicyInMemory(state.privacySettings);
    await flushTerminalPersistence();

    const persisted = state.restoredTerminalSessions.find(({ clientId }) => clientId === "after-explicit-off");
    expect(JSON.stringify(persisted)).not.toContain("future-off");
    expect(persisted).not.toHaveProperty("command");
  });

  it("sanitizes hydration started after explicit Clear even when disk still returns raw records", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    const store = storeWithRestoredSessions([]);
    vi.mocked(store.getState).mockReturnValue(hydration.promise);
    configureTerminalPersistence(store, { debounceMs: 60_000 });
    registerTerminalIpc();
    applyTerminalPrivacyPolicyInMemory(DEFAULT_DESKTOP_STATE.privacySettings, true);

    const pendingList = invoke<TerminalListResult>(terminalChannels.list);
    hydration.resolve(stateWithRestoredSessions(staleHydrationSessions("after-clear")));
    const listed = await pendingList;

    expect(listed.restoredSessions).toEqual([
      {
        clientId: "after-clear-isolated",
        title: "Stale isolated",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "workspace-a",
        workspaceRootFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
        isolation: "worktree",
        branchName: "alfred-codex-after-clear-isolated",
      },
    ]);
  });

  it("keeps explicit redactedTail authoritative when later hydration returns stale Off", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    let state: DesktopStateSnapshot = {
      ...stateWithRestoredSessions([]),
      privacySettings: {
        terminalScrollbackRetention: "off",
      },
    };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
      getState: vi.fn(() => hydration.promise),
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
    registerTerminalIpc({
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-after-relaxation",
        cwd: "/alfred/userData/worktrees/after-relaxation",
      }),
    });
    applyTerminalPrivacyPolicyInMemory(DEFAULT_DESKTOP_STATE.privacySettings);

    const pendingList = invoke<TerminalListResult>(terminalChannels.list);
    hydration.resolve(state);
    await pendingList;
    state = { ...state, privacySettings: DEFAULT_DESKTOP_STATE.privacySettings };

    await invoke(terminalChannels.create, {
      agentKind: "codex",
      args: ["allowed-after-relaxation"],
      clientId: "after-relaxation",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      workspaceId: "workspace-a",
    });
    pty.onDataHandler?.("allowed output\n");
    await flushTerminalPersistence();

    expect(state.restoredTerminalSessions.find(({ clientId }) => clientId === "after-relaxation")).toEqual(
      expect.objectContaining({
        args: ["allowed-after-relaxation"],
        baseCwd: "/repo",
        buffer: "allowed output\n",
        command: "codex",
        cwd: "/alfred/userData/worktrees/after-relaxation",
      }),
    );
  });

  it("preserves post-Clear redactedTail mutations while pending hydration sanitizes stale disk records", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    let state = stateWithRestoredSessions([]);
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
      getState: vi.fn(() => hydration.promise),
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
    registerTerminalIpc({
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-post-clear",
        cwd: "/alfred/userData/worktrees/post-clear",
      }),
    });
    applyTerminalPrivacyPolicyInMemory(DEFAULT_DESKTOP_STATE.privacySettings, true);
    applyTerminalPrivacyPolicyInMemory(DEFAULT_DESKTOP_STATE.privacySettings);

    const pendingList = invoke<TerminalListResult>(terminalChannels.list);
    await invoke(terminalChannels.create, {
      agentKind: "codex",
      args: ["allowed-post-clear"],
      clientId: "post-clear",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      workspaceId: "workspace-a",
    });
    pty.onDataHandler?.("post-clear output\n");
    hydration.resolve(stateWithRestoredSessions(staleHydrationSessions("pre-clear")));

    const listed = await pendingList;
    await flushTerminalPersistence();

    expect(listed.restoredSessions).toEqual([
      {
        clientId: "pre-clear-isolated",
        title: "Stale isolated",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "workspace-a",
        workspaceRootFingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
        isolation: "worktree",
        branchName: "alfred-codex-pre-clear-isolated",
      },
    ]);
    expect(state.restoredTerminalSessions.find(({ clientId }) => clientId === "pre-clear-shared")).toBeUndefined();
    expect(state.restoredTerminalSessions.find(({ clientId }) => clientId === "post-clear")).toEqual(
      expect.objectContaining({
        args: ["allowed-post-clear"],
        baseCwd: "/repo",
        buffer: "post-clear output\n",
        command: "codex",
        cwd: "/alfred/userData/worktrees/post-clear",
      }),
    );
    expect(pty.killed).toBe(false);
  });

  it("renames live sessions and persists the updated title", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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

    await invoke(terminalChannels.rename, {
      clientId: "manual-1",
      title: "  \u001b[31mSpec\u001b[0m \u001b]0;spoof\u0007 reviewer  ",
    });
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
      ...persistedStateStoreMethods(() => state),
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
    await expect(invoke(terminalChannels.forget, { clientId: "manual-1" })).resolves.toEqual({ ok: true });

    expect(state.restoredTerminalSessions).toEqual([]);
  });

  it("hydrates persisted snapshots before a quit-time flush", async () => {
    const persistedSnapshot: PersistedTerminalSessionSnapshot = {
      clientId: "persisted-before-quit",
      title: "Persisted before quit",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      buffer: "saved transcript\n",
    };
    let state = stateWithRestoredSessions([persistedSnapshot]);
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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

    await flushTerminalPersistence();

    expect(store.getState).toHaveBeenCalledOnce();
    expect(state.restoredTerminalSessions).toEqual([persistedSnapshot]);
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
    const pendingForget = invoke(terminalChannels.forget, { clientId: snapshot.clientId });
    hydration.resolve(stateWithRestoredSessions([snapshot]));

    await expect(Promise.all([pendingList, pendingForget])).resolves.toEqual([
      expect.objectContaining({ sessions: [] }),
      { ok: true },
    ]);
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([]);
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
      ...persistedStateStoreMethods(() => persistedState),
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

  it("does not flush a partial snapshot map while zero-debounce hydration is in flight", async () => {
    const hydration = deferred<DesktopStateSnapshot>();
    const persistedSnapshot: PersistedTerminalSessionSnapshot = {
      clientId: "persisted-before-hydration",
      title: "Persisted before hydration",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/zsh",
      buffer: "persisted\n",
    };
    let persistedState = stateWithRestoredSessions([persistedSnapshot]);
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => persistedState),
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
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(new FakePty()) as never });

    const pendingList = invoke<TerminalListResult>(terminalChannels.list);
    await invoke(terminalChannels.create, {
      clientId: "remembered-during-hydration",
      cols: 80,
      cwd: "/repo",
      rows: 24,
      title: "Fresh title",
    });
    await Promise.resolve();
    expect(store.updateState).not.toHaveBeenCalled();
    hydration.resolve(stateWithRestoredSessions([persistedSnapshot]));
    await pendingList;
    await flushTerminalPersistence();

    expect(persistedState.restoredTerminalSessions.map((session) => session.clientId).sort()).toEqual([
      "persisted-before-hydration",
      "remembered-during-hydration",
    ]);
  });

  it("flushes pending terminal snapshots without waiting for the debounce timer", async () => {
    let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
    const store: PersistedDesktopStateStore = {
      ...persistedStateStoreMethods(() => state),
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
      ...persistedStateStoreMethods(() => state),
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
      payload: { id: created.id, clientId: "manual-1", data: "hello\n", activities: [], at: expect.any(Number) },
      windowId: 1,
    });
    expect(sentEvents).toContainEqual({
      channel: terminalChannels.exit,
      payload: { id: created.id, clientId: "manual-1", exitCode: 0 },
      windowId: 1,
    });
    expect(listed.sessions).toEqual([]);
  });

  it("uses the same output timestamp in data events and list snapshots", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      command: "node", cols: 80, cwd: "/repo", rows: 24,
    });

    pty.onDataHandler?.("fixture\n");

    const dataEvent = sentEvents.find((event) => event.channel === terminalChannels.data)?.payload as TerminalDataEvent;
    const listed = await invoke<TerminalListResult>(terminalChannels.list);
    expect(dataEvent.at).toEqual(expect.any(Number));
    expect(dataEvent.at).toBe(listed.sessions.find((session) => session.id === created.id)?.lastOutputAt);
  });

  it("waits for closed and quit-killed terminals to report exit, bounded by a timeout", async () => {
    const closedPty = new FakePty();
    const quitPty = new FakePty();
    const ptys = [closedPty, quitPty];
    registerTerminalIpc({
      loadNodePty: async () => ({ spawn: vi.fn(() => ptys.shift()) }) as never,
    });
    const closed = await invoke<{ id: string }>(terminalChannels.create, { command: "node", cols: 80, cwd: "/repo", rows: 24 });
    await invoke(terminalChannels.create, { command: "node", cols: 80, cwd: "/repo", rows: 24 });

    emit(terminalChannels.kill, { id: closed.id });
    killAllTerminalSessions();
    let settled = false;
    const waiting = waitForTerminalExits(60_000).then(() => { settled = true; });

    closedPty.onExitHandler?.({ exitCode: 0, signal: 1 });
    await Promise.resolve();
    expect(settled).toBe(false);

    quitPty.onExitHandler?.({ exitCode: 0, signal: 1 });
    await waiting;
    expect(settled).toBe(true);

    vi.useFakeTimers();
    try {
      const stuckPty = new FakePty();
      ptys.push(stuckPty);
      await invoke(terminalChannels.create, { command: "node", cols: 80, cwd: "/repo", rows: 24 });
      killAllTerminalSessions();
      const timedOut = waitForTerminalExits(2_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(timedOut).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps app-only environment out of terminal sessions while preserving the user environment", async () => {
    vi.stubEnv("ALFRED_TEST_APP_ONLY_SECRET", "synthetic-app-secret");
    vi.stubEnv("ALFRED_TEST_USER_TOKEN", "synthetic-user-token");
    const pty = new FakePty();
    const nodePty = fakeNodePty(pty);
    registerTerminalIpc({
      appOnlyEnvKeys: new Set(["ALFRED_TEST_APP_ONLY_SECRET"]),
      loadNodePty: async () => nodePty as never,
    });

    await invoke(terminalChannels.create, { command: "node", cols: 80, cwd: "/repo", rows: 24 });

    const env = (nodePty.spawn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }])[2].env;
    expect(env).not.toHaveProperty("ALFRED_TEST_APP_ONLY_SECRET");
    expect(env).toMatchObject({
      ALFRED_TEST_USER_TOKEN: "synthetic-user-token",
      PATH: process.env.PATH,
      TERM: "xterm-256color",
      FORCE_HYPERLINK: "1",
    });
  });

  it("hands each agent the event log's environment and arguments after its own", async () => {
    const spawn = vi.fn(() => new FakePty());
    registerTerminalIpc({
      agentEvents: {
        clear: async () => {},
        close: async () => {},
        env: (session, command) => (command === "claude" ? { OTEL_LOGS_EXPORTER: "otlp", EVENT_SESSION: `${session.clientId}/${session.id}` } : {}),
        launchArgs: (session, command) => (command === "codex" ? ["-c", `otel.session=${session.clientId}/${session.id}`] : []),
      },
      loadNodePty: async () => ({ spawn }) as never,
    });

    const claude = await invoke<{ id: string }>(terminalChannels.create, { clientId: "claude-1", command: "claude", cols: 80, cwd: "/repo", rows: 24 });
    const codex = await invoke<{ id: string }>(terminalChannels.create, { clientId: "codex-1", command: "codex", cols: 80, cwd: "/repo", rows: 24 });

    // The log gets the Alfred session id, which a resumed process keeps, as well as the process's own.
    const [claudeCall, codexCall] = spawn.mock.calls as unknown as Array<[string, string[], { env: Record<string, string> }]>;
    expect(claudeCall![2].env).toMatchObject({ OTEL_LOGS_EXPORTER: "otlp", EVENT_SESSION: `claude-1/${claude.id}` });
    expect(codexCall![1]).toEqual([...CODEX_NOTIFICATION_ARGS, "-c", `otel.session=codex-1/${codex.id}`]);
    expect(codexCall![2].env).not.toHaveProperty("OTEL_LOGS_EXPORTER");
  });

  it("reports whether terminal data is saved, which the agent event log follows", () => {
    applyTerminalPrivacyPolicyInMemory({ ...DEFAULT_DESKTOP_STATE.privacySettings, terminalScrollbackRetention: "off" });
    expect(savesTerminalData()).toBe(false);
    applyTerminalPrivacyPolicyInMemory({ ...DEFAULT_DESKTOP_STATE.privacySettings, terminalScrollbackRetention: "redactedTail" });
    expect(savesTerminalData()).toBe(true);
  });

  it.each([
    ["Clear", () => applyTerminalPrivacyPolicyInMemory({ ...DEFAULT_DESKTOP_STATE.privacySettings }, true)],
    [
      "retention off",
      () => applyTerminalPrivacyPolicyInMemory({ ...DEFAULT_DESKTOP_STATE.privacySettings, terminalScrollbackRetention: "off" }),
    ],
  ])("drops the exited terminal output and launch arguments on %s", async (_name, applyPolicy) => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      args: ["PRIVATE_ARGUMENT"],
      clientId: "exited-private",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    });
    pty.onDataHandler?.("PRIVATE_OUTPUT_BEFORE_CLEAR\n");
    pty.onExitHandler?.({ exitCode: 0 });

    applyPolicy();

    const reconciled = await invoke<{ state: string; snapshot: object; event: { exitCode: number } }>(
      "alfred:terminal:reconcile",
      { id: created.id, clientId: "exited-private" },
    );
    expect(reconciled.state).toBe("exited");
    expect(reconciled.event.exitCode).toBe(0);
    expect(JSON.stringify(reconciled.snapshot)).not.toMatch(/PRIVATE_OUTPUT_BEFORE_CLEAR|PRIVATE_ARGUMENT/);
  });

  it("does not keep output of a terminal that exits while retention is off", async () => {
    applyTerminalPrivacyPolicyInMemory({ ...DEFAULT_DESKTOP_STATE.privacySettings, terminalScrollbackRetention: "off" });
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "exits-off",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    });
    pty.onDataHandler?.("PRIVATE_OUTPUT_WHILE_OFF\n");
    pty.onExitHandler?.({ exitCode: 1 });

    const snapshot = await invoke<object>(terminalChannels.snapshot, { id: created.id });
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_OUTPUT_WHILE_OFF");
  });

  describe("a failed launch of an isolated checkout", () => {
    const created = {
      baseCwd: "/repo",
      branchName: "alfred-codex-failed-launch",
      cwd: "/alfred/userData/worktrees/failed-launch",
    };
    const launch = {
      agentKind: "codex",
      clientId: "failed-launch",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
    };

    function failingLaunch(stage: "loadNodePty" | "spawn") {
      const cleanupAgentWorktree = vi.fn(async () => undefined);
      const failure = new Error(`${stage} failed`);
      registerTerminalIpc({
        cleanupAgentWorktree,
        loadNodePty: stage === "loadNodePty"
          ? async () => { throw failure; }
          : async () => ({ spawn: vi.fn(() => { throw failure; }) }) as never,
        managedWorktreeRootPath: "/alfred/userData/worktrees",
        prepareAgentWorktree: vi.fn(async () => created),
      });
      return { cleanupAgentWorktree, failure };
    }

    it.each(["loadNodePty", "spawn"] as const)("removes the checkout it created when %s fails", async (stage) => {
      const { cleanupAgentWorktree, failure } = failingLaunch(stage);

      await expect(invoke(terminalChannels.create, launch)).rejects.toThrow(failure.message);

      expect(cleanupAgentWorktree).toHaveBeenCalledWith(
        { ...created, force: true },
        { worktreeStoreRoot: "/alfred/userData/worktrees" },
      );
    });

    it("keeps a reused checkout that holds earlier work", async () => {
      const cleanupAgentWorktree = vi.fn(async () => undefined);
      registerTerminalIpc({
        cleanupAgentWorktree,
        loadNodePty: async () => { throw new Error("loadNodePty failed"); },
        managedWorktreeRootPath: "/alfred/userData/worktrees",
        prepareAgentWorktree: vi.fn(),
      });

      const reused = {
        ...created,
        cwd: path.join(managedProjectWorktreeRoot("/alfred/userData/worktrees", "/repo"), created.branchName),
      };

      await expect(invoke(terminalChannels.create, { ...launch, ...reused })).rejects.toThrow("loadNodePty failed");

      expect(cleanupAgentWorktree).not.toHaveBeenCalled();
    });
  });

  it.each([false, true])("discards ended scrollback from persistence and the exit cache (retention off: %s)", async (retentionOff) => {
    const store = storeWithRestoredSessions([]);
    configureTerminalPersistence(store, { debounceMs: 0 });
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "discard-ended", command: "node", cols: 80, cwd: "/repo", rows: 24,
    });
    pty.onDataHandler?.("kept output");
    pty.onExitHandler?.({ exitCode: 1 });
    await expect(invoke(terminalChannels.snapshot, { id: created.id })).resolves.toMatchObject({ buffer: "kept output" });
    if (retentionOff) {
      applyTerminalPrivacyPolicyInMemory({ ...DEFAULT_DESKTOP_STATE.privacySettings, terminalScrollbackRetention: "off" });
    }
    await expect(invoke(terminalChannels.forget, { clientId: "discard-ended", cleanupWorktree: true })).resolves.toEqual({ ok: true });
    expect((await store.getState()).restoredTerminalSessions).toEqual([]);
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([]);
    await expect(invoke(terminalChannels.snapshot, { id: created.id })).resolves.toBeNull();
    await expect(invoke(terminalChannels.reconcile, { id: created.id })).resolves.toEqual({ state: "missing" });
  });

  it("keeps ended scrollback available when Discard persistence fails", async () => {
    const store = storeWithRestoredSessions([]);
    configureTerminalPersistence(store, { debounceMs: 0 });
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "discard-failure", command: "node", cols: 80, cwd: "/repo", rows: 24,
    });
    pty.onDataHandler?.("keep on failure");
    pty.onExitHandler?.({ exitCode: 1 });
    await flushTerminalPersistence();
    vi.mocked(store.updateState).mockRejectedValueOnce(new Error("disk full"));
    await expect(invoke(terminalChannels.forget, { clientId: "discard-failure" })).resolves.toEqual({ ok: false, error: "disk full" });
    expect((await store.getState()).restoredTerminalSessions).toEqual([expect.objectContaining({ clientId: "discard-failure" })]);
    await expect(invoke(terminalChannels.snapshot, { id: created.id })).resolves.toMatchObject({ buffer: "keep on failure" });
    await expect(invoke(terminalChannels.reconcile, { id: created.id })).resolves.toMatchObject({ state: "exited" });
  });

  it("reconciles a terminal that exits before the renderer attaches its exit listener", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      clientId: "fast-exit",
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    });

    pty.onDataHandler?.("failed before attach\n");
    pty.onExitHandler?.({ exitCode: 7, signal: 9 });

    const reconciled = await invoke<{
      state: string;
      snapshot: { buffer: string; activityEvents?: Array<{ kind: string; title: string }> };
      event: { id: string; clientId?: string; exitCode: number; signal?: number };
    }>("alfred:terminal:reconcile", { id: created.id, clientId: "fast-exit" });

    expect(reconciled).toEqual({
      state: "exited",
      snapshot: expect.objectContaining({
        id: created.id,
        clientId: "fast-exit",
        buffer: "failed before attach\n",
        activityEvents: expect.arrayContaining([
          expect.objectContaining({
            kind: "lifecycle",
            title: "Process exited",
          }),
        ]),
      }),
      event: { id: created.id, clientId: "fast-exit", exitCode: 7, signal: 9 },
    });
    await expect(
      invoke<TerminalSnapshotResult>(terminalChannels.snapshot, { id: created.id }),
    ).resolves.toEqual(expect.objectContaining({ buffer: "failed before attach\n" }));

    const otherWindow = fakeWindow(2);
    liveWindows.push(otherWindow);
    await expect(
      invoke("alfred:terminal:reconcile", { id: created.id }, senderFor(otherWindow)),
    ).resolves.toEqual({ state: "missing" });
    await expect(
      invoke<TerminalSnapshotResult>(terminalChannels.snapshot, { id: created.id }, senderFor(otherWindow)),
    ).resolves.toBeNull();
  });

  it("keeps only the newest 64 terminal exit records available for reconciliation", async () => {
    const ptys: FakePty[] = [];
    const nodePty = {
      spawn: vi.fn(() => {
        const pty = new FakePty();
        ptys.push(pty);
        return pty;
      }),
    };
    registerTerminalIpc({ loadNodePty: async () => nodePty as never });
    const ids: string[] = [];

    for (let index = 0; index < 65; index += 1) {
      const created = await invoke<{ id: string }>(terminalChannels.create, {
        command: "node",
        cols: 80,
        cwd: "/repo",
        rows: 24,
      });
      ids.push(created.id);
      ptys[index]?.onExitHandler?.({ exitCode: index });
    }

    await expect(
      invoke("alfred:terminal:reconcile", { id: ids[0] }),
    ).resolves.toEqual({ state: "missing" });
    await expect(
      invoke("alfred:terminal:reconcile", { id: ids[64] }),
    ).resolves.toEqual(expect.objectContaining({
      state: "exited",
      event: expect.objectContaining({ id: ids[64], exitCode: 64 }),
    }));
  });

  it("does not reconcile a terminal that the user explicitly killed", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, {
      command: "node",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    });

    emit(terminalChannels.kill, { id: created.id });
    pty.onExitHandler?.({ exitCode: 0 });

    await expect(
      invoke("alfred:terminal:reconcile", { id: created.id }),
    ).resolves.toEqual({ state: "missing" });
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
      payload: { id: created.id, data: "Approval re", activities: [], at: expect.any(Number) },
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

  it.each([
    { agentKind: "codex" as const, foregroundProcess: "node" },
    { agentKind: "claude" as const, foregroundProcess: "2.1.220" },
  ])("reports $agentKind with foreground process $foregroundProcess in terminal data and live snapshots", async ({
    agentKind,
    foregroundProcess,
  }) => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<TerminalCreateResult>(terminalChannels.create, {
      clientId: `manual-${agentKind}`,
      cols: 80,
      cwd: "/repo",
      rows: 24,
      source: "manual",
    });

    emit(terminalChannels.write, { id: created.id, data: `${agentKind}\r` });
    pty.process = foregroundProcess;
    pty.onDataHandler?.("Ready\n");

    const dataEvent = sentEvents
      .filter((event) => event.channel === terminalChannels.data)
      .at(-1)?.payload;
    const listed = await invoke<TerminalListResult>(terminalChannels.list);

    expect(dataEvent).toMatchObject({
      id: created.id,
      clientId: `manual-${agentKind}`,
      foregroundAgentKind: agentKind,
    });
    expect(listed.sessions[0]).toMatchObject({ foregroundAgentKind: agentKind });

    pty.process = path.basename(created.shell);
    pty.onDataHandler?.("% ");

    const shellEvent = sentEvents
      .filter((event) => event.channel === terminalChannels.data)
      .at(-1)?.payload;
    const shellList = await invoke<TerminalListResult>(terminalChannels.list);
    expect(shellEvent).not.toHaveProperty("foregroundAgentKind");
    expect(shellList.sessions[0]).not.toHaveProperty("foregroundAgentKind");
  });

  it.each([
    ["recalled with the up arrow", "\x1b[A\r", "node /opt/homebrew/bin/codex", "codex"],
    ["completed with Tab", "cla\t\r", "/Users/sample/.local/bin/claude --resume", "claude"],
  ])("recognises an agent %s from its foreground process", async (_how, typed, args, agentKind) => {
    const pty = new FakePty();
    const inspectForegroundCommand = vi.fn(async () => args);
    registerTerminalIpc({ inspectForegroundCommand, loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<TerminalCreateResult>(terminalChannels.create, {
      clientId: "manual-1", cols: 80, cwd: "/repo", rows: 24, source: "manual",
    });

    emit(terminalChannels.write, { id: created.id, data: typed });
    pty.process = agentKind === "codex" ? "node" : "2.1.302";
    pty.onDataHandler?.("Starting\n");
    await vi.waitFor(() => expect(inspectForegroundCommand).toHaveBeenCalledOnce());

    await vi.waitFor(async () => {
      const listed = await invoke<TerminalListResult>(terminalChannels.list);
      expect(listed.sessions[0]).toMatchObject({ foregroundAgentKind: agentKind });
    });
    expect(sentEvents.filter((event) => event.channel === terminalChannels.data).at(-1)?.payload)
      .toMatchObject({ data: "", foregroundAgentKind: agentKind });
    // Asked once per foreground process, not on every chunk of its output.
    pty.onDataHandler?.("More output\n");
    expect(inspectForegroundCommand).toHaveBeenCalledOnce();
  });

  it("does not take a file named after an agent for the agent", async () => {
    const pty = new FakePty();
    registerTerminalIpc({
      inspectForegroundCommand: async () => "vim codex-notes.md",
      loadNodePty: async () => fakeNodePty(pty) as never,
    });
    const created = await invoke<TerminalCreateResult>(terminalChannels.create, {
      clientId: "manual-1", cols: 80, cwd: "/repo", rows: 24, source: "manual",
    });
    emit(terminalChannels.write, { id: created.id, data: "\x1b[A\r" });
    pty.process = "vim";
    pty.onDataHandler?.("~\n");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const listed = await invoke<TerminalListResult>(terminalChannels.list);
    expect(listed.sessions[0]).not.toHaveProperty("foregroundAgentKind");
  });

  it("keeps a typed agent's kind on an update that carries only its signal", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<TerminalCreateResult>(terminalChannels.create, {
      clientId: "manual-1", cols: 80, cwd: "/repo", rows: 24, source: "manual",
    });
    emit(terminalChannels.write, { id: created.id, data: "codex\r" });
    pty.process = "codex";
    pty.onDataHandler?.("\x1b]9;Approval requested: ls\x07");

    // Your answer clears Needs you with an update that has no output.
    emit(terminalChannels.write, { id: created.id, data: "y" });

    const update = sentEvents.filter((event) => event.channel === terminalChannels.data).at(-1)?.payload;
    expect(update).toMatchObject({ data: "", agentSignal: null, foregroundAgentKind: "codex" });
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
      payload: { id: created.id, data: "Bash(\"pnpm test\")\n", activities: [], at: expect.any(Number) },
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

  it("relaunches an exact saved manual cwd when its legacy workspace is no longer bound", async () => {
    const nodePty = fakeNodePty(new FakePty());
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: "manual-legacy",
      title: "Legacy manual terminal",
      workspaceId: "W16",
      cwd: "/legacy/unbound/project",
      source: "manual",
      shell: "/bin/zsh",
      buffer: "saved transcript\n",
    };
    configureTerminalPersistence(storeWithRestoredSessions([snapshot]), { debounceMs: 0 });
    registerTerminalIpc({
      allowedCwdRoots: async () => ["/repo"],
      loadNodePty: async () => nodePty as never,
    });

    const created = await invoke<TerminalCreateResult>(terminalChannels.create, {
      clientId: snapshot.clientId,
      cols: 80,
      cwd: snapshot.cwd,
      rows: 24,
      source: snapshot.source,
      workspaceId: snapshot.workspaceId,
    });

    const relaunched = await invoke<TerminalSnapshotResult>(terminalChannels.snapshot, { id: created.id });

    expect(nodePty.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: snapshot.cwd }),
    );
    expect(relaunched?.buffer).toBe("saved transcript\n");
  });

  it.each(["codex", "claude"] as const)("persists a manually started %s session as resumable", async (agentKind) => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });

    const created = await invoke<TerminalCreateResult>(terminalChannels.create, {
      clientId: `manual-${agentKind}`,
      cols: 80,
      cwd: "/repo",
      rows: 24,
      source: "manual",
      title: "Manual terminal",
    });
    emit(terminalChannels.write, { id: created.id, data: `${agentKind}\r` });
    pty.process = agentKind;
    pty.onDataHandler?.(`${agentKind} ready\n`);
    pty.onExitHandler?.({ exitCode: 0 });

    const listed = await invoke<TerminalListResult>(terminalChannels.list);
    expect(listed.restoredSessions).toContainEqual(expect.objectContaining({
      clientId: `manual-${agentKind}`,
      agentKind,
      command: agentKind,
      args: [],
      buffer: `${agentKind} ready\n`,
    }));
  });

  const savedConversation = "6f1c2a4e-8b1d-4c3e-9f2a-0d5e7b8c9a10";

  it.each([
    { agentKind: "codex" as const, args: ["resume", "--last"] },
    { agentKind: "claude" as const, args: ["--continue"] },
    {
      agentKind: "claude" as const,
      args: ["--resume", savedConversation],
      resumeTarget: { agentKind: "claude" as const, sessionId: savedConversation, source: "agent-hook" as const },
    },
  ])("resumes an exact saved $agentKind session ($args) when its legacy workspace is no longer bound", async ({
    agentKind,
    args,
    resumeTarget,
  }) => {
    const nodePty = fakeNodePty(new FakePty());
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: `${agentKind}-legacy`,
      title: `${agentKind} legacy session`,
      workspaceId: "W16",
      cwd: "/legacy/unbound/project",
      source: "manual",
      agentKind,
      shell: agentKind,
      command: agentKind,
      args: ["original prompt"],
      ...(resumeTarget === undefined ? {} : { resumeTarget }),
      buffer: "saved transcript\n",
    };
    configureTerminalPersistence(storeWithRestoredSessions([snapshot]), { debounceMs: 0 });
    registerTerminalIpc({
      allowedCwdRoots: async () => ["/repo"],
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });
    const request: TerminalCreateRequest = {
      agentKind,
      args,
      clientId: snapshot.clientId,
      cols: 80,
      command: agentKind,
      ...(snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd }),
      rows: 24,
      source: snapshot.source,
      ...(snapshot.workspaceId === undefined ? {} : { workspaceId: snapshot.workspaceId }),
      ...(resumeTarget === undefined ? {} : { resumeTarget }),
    };

    const prepared = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
    await invoke(terminalChannels.create, { ...request, launchTicketId: prepared.launchTicketId });

    expect(nodePty.spawn).toHaveBeenCalledWith(
      agentKind,
      agentKind === "codex" ? [...CODEX_NOTIFICATION_ARGS, ...args] : args,
      expect.objectContaining({ cwd: snapshot.cwd }),
    );
  });

  it("does not let a saved Claude session outside the bound folders resume a different conversation", async () => {
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: "claude-legacy",
      title: "Claude legacy session",
      workspaceId: "W16",
      cwd: "/legacy/unbound/project",
      source: "manual",
      agentKind: "claude",
      shell: "claude",
      command: "claude",
      args: [],
      resumeTarget: { agentKind: "claude", sessionId: savedConversation, source: "agent-hook" },
      buffer: "saved transcript\n",
    };
    configureTerminalPersistence(storeWithRestoredSessions([snapshot]), { debounceMs: 0 });
    registerTerminalIpc({
      allowedCwdRoots: async () => ["/repo"],
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      requireLaunchTickets: true,
    });
    const other = "7a2d3b5f-9c2e-4d4f-8a3b-1e6f8c9dab21";

    await expect(invoke(terminalChannels.prepareLaunch, {
      agentKind: "claude",
      args: ["--resume", other],
      clientId: snapshot.clientId,
      cols: 80,
      command: "claude",
      cwd: snapshot.cwd,
      resumeTarget: { agentKind: "claude", sessionId: other, source: "agent-hook" },
      rows: 24,
      source: snapshot.source,
      workspaceId: snapshot.workspaceId,
    })).rejects.toThrow("Terminal cwd is outside registered workspaces.");
  });

  it("lets Codex report its turns through OSC 9 when the hook bridge is unavailable", async () => {
    const nodePty = fakeNodePty(new FakePty());
    registerTerminalIpc({ loadNodePty: async () => nodePty as never });
    const request = { clientId: "codex-1", cols: 80, command: "codex", cwd: "/repo", rows: 24 };

    const prepared = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
    await invoke(terminalChannels.create, { ...request, launchTicketId: prepared.launchTicketId });

    expect(nodePty.spawn).toHaveBeenCalledWith(
      "codex",
      ["-c", "tui.notifications=true", "-c", 'tui.notification_method="osc9"', "-c", 'tui.notification_condition="always"'],
      expect.objectContaining({ cwd: "/repo" }),
    );
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
      ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
      ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
      cols: 80,
      ...(snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd }),
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

  it("rejects an exact persisted restored command when the cwd differs", async () => {
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
      requireLaunchTickets: true,
    });

    await expect(
      invoke(terminalChannels.prepareLaunch, {
        clientId: snapshot.clientId,
        command: snapshot.command,
        args: snapshot.args,
        cols: 80,
        cwd: "/tmp/alfred-scratch",
        rows: 24,
        source: "manual",
      }),
    ).rejects.toThrow("Terminal command is not approved for launch.");
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
      ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
      ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
      cols: 80,
      ...(snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd }),
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
      ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
      ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
      cols: 80,
      ...(snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd }),
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
        [...CODEX_NOTIFICATION_ARGS],
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
        [...CODEX_NOTIFICATION_ARGS],
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
      [...CODEX_NOTIFICATION_ARGS],
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
      [...CODEX_NOTIFICATION_ARGS],
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

  it("retains a live isolated checkout after Close and restores it after fresh hydration", async () => {
    let state = stateWithRestoredSessions([]);
    const store = storeWithRestoredSessions([]);
    vi.mocked(store.updateState).mockImplementation(async (updater) => {
      state = await updater(state);
      return state;
    });
    vi.mocked(store.getState).mockImplementation(async () => state);
    const pty = new FakePty();
    const cleanupAgentWorktree = vi.fn(async (): Promise<void> => undefined);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-close",
        cwd: "/alfred/userData/worktrees/close",
      }),
    });

    const created = await invoke<{ id: string }>(terminalChannels.create, {
      agentKind: "codex",
      clientId: "codex-close",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
      source: "alfred",
      workspaceId: "A",
    });
    pty.onDataHandler?.("latest output\n");
    emit(terminalChannels.kill, { id: created.id });
    await flushTerminalPersistence();

    expect(pty.killed).toBe(true);
    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
    expect(state.restoredTerminalSessions).toEqual([
      expect.objectContaining({
        clientId: "codex-close",
        buffer: "latest output\n",
        activityEvents: expect.arrayContaining([
          expect.objectContaining({ title: "Closed by user" }),
        ]),
      }),
    ]);

    resetTerminalPersistenceForTests();
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc();

    const listed = await invoke<TerminalListResult>(terminalChannels.list);
    expect(listed.restoredSessions).toEqual([
      expect.objectContaining({ clientId: "codex-close", buffer: "latest output\n" }),
    ]);
  });

  it("resolves sanitized isolated checkout operations through the authoritative workspace root", async () => {
    const inspectAgentWorktree = vi.fn(async () => ({ summary: "1 changed file", files: [], patch: "", applied: false }));
    const resolveWorkspaceRoot = vi.fn(async (workspaceId: string) => workspaceId === "A" ? "/repo" : undefined);
    configureTerminalPersistence(storeWithRestoredSessions([{
      clientId: "sanitized",
      title: "Sanitized checkout",
      source: "alfred",
      agentKind: "codex",
      workspaceId: "A",
      workspaceRootFingerprint: workspaceRootFingerprint("/repo"),
      isolation: "worktree",
      branchName: "alfred-codex-sanitized",
    }]), { debounceMs: 0 });
    registerTerminalIpc({
      inspectAgentWorktree,
      resolveWorkspaceRoot,
    });

    await expect(invoke(terminalChannels.worktreeDiff, { clientId: "sanitized" })).resolves.toEqual({
      ok: true,
      summary: "1 changed file",
      files: [],
      applied: false,
      patch: "",
    });
    expect(resolveWorkspaceRoot).toHaveBeenCalledWith("A");
    expect(inspectAgentWorktree).toHaveBeenCalledWith({
      baseCwd: "/repo",
      branchName: "alfred-codex-sanitized",
    }, {});
  });

  it("manages a checkout of a project that is a folder inside its repository", async () => {
    const temporaryRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "alfred-subfolder-project-")));
    const repository = path.join(temporaryRoot, "monorepo");
    const project = path.join(repository, "packages", "app");
    const worktreeStoreRoot = path.join(temporaryRoot, "user-data", "worktrees");
    const branchName = "alfred-codex-subfolder";
    try {
      await fs.mkdir(project, { recursive: true });
      await fs.mkdir(worktreeStoreRoot, { recursive: true });
      await promisify(execFileCallback)("git", ["init", "-q", repository]);
      // Checkouts are made from the repository's root, and the session starts in the project's folder inside one.
      const worktree = path.join(managedProjectWorktreeRoot(worktreeStoreRoot, repository), branchName);
      await fs.mkdir(path.join(worktree, "packages", "app"), { recursive: true });
      const inspectAgentWorktree = vi.fn(async () => ({ summary: "1 changed file", files: [], patch: "", applied: false }));
      configureTerminalPersistence(storeWithRestoredSessions([{
        clientId: "subfolder",
        title: "Codex",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "A",
        workspaceRootFingerprint: workspaceRootFingerprint(repository),
        cwd: path.join(worktree, "packages", "app"),
        baseCwd: repository,
        isolation: "worktree",
        branchName,
        createdAt: 1,
        shell: "codex",
        command: "codex",
        buffer: "",
      }]), { debounceMs: 0 });
      registerTerminalIpc({ inspectAgentWorktree, managedWorktreeRootPath: worktreeStoreRoot, resolveWorkspaceRoot: async () => project });

      await expect(invoke(terminalChannels.worktreeDiff, { clientId: "subfolder" })).resolves.toEqual({
        ok: true,
        summary: "1 changed file",
        files: [],
        applied: false,
        patch: "",
      });
      expect(inspectAgentWorktree).toHaveBeenCalledWith(expect.objectContaining({ baseCwd: repository, branchName }), {
        worktreeStoreRoot,
      });
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("reviews a recovered checkout when the authoritative workspace root uses a filesystem alias", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-recovered-terminal-"));
    const physicalParent = path.join(temporaryRoot, "private", "var");
    const aliasParent = path.join(temporaryRoot, "var");
    const canonicalBaseCwd = path.join(physicalParent, "folders", "fixture", "workspace-a");
    const aliasedBaseCwd = path.join(aliasParent, "folders", "fixture", "workspace-a");
    const worktreeStoreRoot = path.join(physicalParent, "folders", "fixture", "user-data", "worktrees");
    const branchName = "alfred-codex-recovered";

    try {
      await fs.mkdir(canonicalBaseCwd, { recursive: true });
      await fs.mkdir(worktreeStoreRoot, { recursive: true });
      await fs.symlink(physicalParent, aliasParent);
      const canonicalWorktree = path.join(
        managedProjectWorktreeRoot(worktreeStoreRoot, canonicalBaseCwd),
        branchName,
      );
      await fs.mkdir(canonicalWorktree, { recursive: true });

      const inspectAgentWorktree = vi.fn(async () => ({ summary: "2 changed files", files: [], patch: "", applied: false }));
      configureTerminalPersistence(storeWithRestoredSessions([{
        clientId: "s4-fresh-apply",
        title: "S4 fresh Apply fixture",
        source: "alfred",
        agentKind: "codex",
        workspaceId: "A",
        workspaceRootFingerprint: workspaceRootFingerprint(canonicalBaseCwd),
        cwd: canonicalWorktree,
        baseCwd: canonicalBaseCwd,
        isolation: "worktree",
        branchName,
        createdAt: 1,
        shell: "codex",
        command: "codex",
        buffer: "Output cleared when Alfred closed.",
      }]), { debounceMs: 0 });
      registerTerminalIpc({
        inspectAgentWorktree,
        managedWorktreeRootPath: worktreeStoreRoot,
        resolveWorkspaceRoot: async () => aliasedBaseCwd,
      });

      await expect(invoke(terminalChannels.worktreeDiff, { clientId: "s4-fresh-apply" })).resolves.toEqual({
        ok: true,
        summary: "2 changed files",
        files: [],
        applied: false,
        patch: "",
      });
      expect(inspectAgentWorktree).toHaveBeenCalledWith({
        baseCwd: aliasedBaseCwd,
        branchName,
        cwd: canonicalWorktree,
      }, {
        worktreeStoreRoot,
      });
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "missing workspace",
      fingerprint: workspaceRootFingerprint("/repo"),
      resolvedRoot: undefined,
      error: "Reattach the original project before managing this checkout.",
    },
    {
      name: "workspace fingerprint mismatch",
      fingerprint: workspaceRootFingerprint("/other"),
      resolvedRoot: "/repo",
      error: "This workspace points to a different project. Reattach the original project first.",
    },
  ])("rejects sanitized operations for $name before worktree access", async ({ error, fingerprint, resolvedRoot }) => {
    const inspectAgentWorktree = vi.fn(async () => ({ summary: "unexpected", files: [], patch: "", applied: false }));
    const applyAgentWorktreePatch = vi.fn(async () => ({ appliedFiles: 1 }));
    const cleanupAgentWorktree = vi.fn(async (): Promise<void> => undefined);
    configureTerminalPersistence(storeWithRestoredSessions([{
      clientId: "sanitized",
      title: "Sanitized checkout",
      source: "alfred",
      agentKind: "codex",
      workspaceId: "A",
      workspaceRootFingerprint: fingerprint,
      isolation: "worktree",
      branchName: "alfred-codex-sanitized",
    }]), { debounceMs: 0 });
    registerTerminalIpc({
      applyAgentWorktreePatch,
      cleanupAgentWorktree,
      inspectAgentWorktree,
      resolveWorkspaceRoot: async () => resolvedRoot,
    });

    await expect(invoke(terminalChannels.worktreeDiff, { clientId: "sanitized" })).resolves.toEqual({
      ok: false,
      error,
    });
    await expect(invoke(terminalChannels.worktreeApply, { clientId: "sanitized" })).resolves.toEqual({
      ok: false,
      error,
      needsManualReview: true,
    });
    await expect(invoke(terminalChannels.forget, {
      clientId: "sanitized",
      cleanupWorktree: true,
    })).resolves.toEqual({ ok: false, error });
    expect(inspectAgentWorktree).not.toHaveBeenCalled();
    expect(applyAgentWorktreePatch).not.toHaveBeenCalled();
    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
  });

  it("forgets an isolated snapshot only after cleanup succeeds and persistence flushes", async () => {
    const cleanup = deferred<void>();
    const store = storeWithRestoredSessions([{
      clientId: "codex-discard",
      title: "Discard checkout",
      source: "alfred",
      agentKind: "codex",
      workspaceId: "A",
      workspaceRootFingerprint: workspaceRootFingerprint("/repo"),
      isolation: "worktree",
      branchName: "alfred-codex-discard",
    }]);
    const cleanupAgentWorktree = vi.fn(() => cleanup.promise);
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      resolveWorkspaceRoot: async () => "/repo",
    });

    const forgetting = invoke(terminalChannels.forget, {
      clientId: "codex-discard",
      cleanupWorktree: true,
    });
    await vi.waitFor(() => expect(cleanupAgentWorktree).toHaveBeenCalledOnce());
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toHaveLength(1);

    cleanup.resolve();
    await expect(forgetting).resolves.toEqual({ ok: true });
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([]);
    expect(cleanupAgentWorktree).toHaveBeenCalledWith({
      baseCwd: "/repo",
      branchName: "alfred-codex-discard",
      force: true,
    }, {
      worktreeStoreRoot: "/alfred/userData/worktrees",
    });
    expect(store.updateState).toHaveBeenCalled();
    expect(cleanupAgentWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(store.updateState).mock.invocationCallOrder.at(-1) ?? 0,
    );
  });

  it.each([
    { name: "omitted", request: {} },
    { name: "false", request: { cleanupWorktree: false } },
  ])("rejects isolated Forget when cleanupWorktree is $name", async ({ request }) => {
    const cleanupAgentWorktree = vi.fn(async (): Promise<void> => undefined);
    configureTerminalPersistence(storeWithRestoredSessions([{
      clientId: "isolated-forget",
      title: "Isolated checkout",
      source: "alfred",
      agentKind: "codex",
      isolation: "worktree",
      branchName: "alfred-codex-isolated-forget",
      baseCwd: "/repo",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-isolated-forget",
    }]), { debounceMs: 0 });
    registerTerminalIpc({ cleanupAgentWorktree });

    await expect(invoke(terminalChannels.forget, {
      clientId: "isolated-forget",
      ...request,
    })).resolves.toEqual({
      ok: false,
      error: "Discarding an isolated checkout requires worktree cleanup.",
    });
    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([
      expect.objectContaining({ clientId: "isolated-forget" }),
    ]);
  });

  it.each([
    { name: "omitted", request: {} },
    { name: "false", request: { cleanupWorktree: false } },
  ])("forgets a shared record non-destructively when cleanupWorktree is $name", async ({ request }) => {
    const cleanupAgentWorktree = vi.fn(async (): Promise<void> => undefined);
    configureTerminalPersistence(storeWithRestoredSessions([{
      clientId: "shared-forget",
      title: "Shared recovery",
      source: "manual",
      isolation: "shared",
      cwd: "/repo",
      shell: "/bin/zsh",
    }]), { debounceMs: 0 });
    registerTerminalIpc({ cleanupAgentWorktree });

    await expect(invoke(terminalChannels.forget, {
      clientId: "shared-forget",
      ...request,
    })).resolves.toEqual({ ok: true });
    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([]);
  });

  it("retains an isolated snapshot when cleanup rejects", async () => {
    const store = storeWithRestoredSessions([{
      clientId: "codex-discard",
      title: "Discard checkout",
      source: "alfred",
      agentKind: "codex",
      isolation: "worktree",
      branchName: "alfred-codex-discard",
      baseCwd: "/repo",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-discard",
    }]);
    const cleanupAgentWorktree = vi.fn(async () => {
      throw new Error("Unable to remove isolated Git worktree.");
    });
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    await expect(invoke(terminalChannels.forget, {
      clientId: "codex-discard",
      cleanupWorktree: true,
    })).resolves.toEqual({ ok: false, error: "Unable to remove isolated Git worktree." });
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([
      expect.objectContaining({ clientId: "codex-discard" }),
    ]);
  });

  it("restores recovery metadata when the post-cleanup persistence flush rejects", async () => {
    const store = storeWithRestoredSessions([{
      clientId: "codex-discard",
      title: "Discard checkout",
      source: "alfred",
      agentKind: "codex",
      isolation: "worktree",
      branchName: "alfred-codex-discard",
      baseCwd: "/repo",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-discard",
    }]);
    vi.mocked(store.updateState).mockRejectedValueOnce(new Error("disk full"));
    configureTerminalPersistence(store, { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree: async () => undefined,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    await expect(invoke(terminalChannels.forget, {
      clientId: "codex-discard",
      cleanupWorktree: true,
    })).resolves.toEqual({ ok: false, error: "disk full" });
    expect(store.updateState).toHaveBeenCalledTimes(2);
    await expect(store.getState()).resolves.toMatchObject({
      restoredTerminalSessions: [expect.objectContaining({ clientId: "codex-discard" })],
    });
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([
      expect.objectContaining({ clientId: "codex-discard" }),
    ]);
  });

  it("stops a running checkout's agent before Discard removes its checkout", async () => {
    const pty = new FakePty();
    const order: string[] = [];
    pty.kill = () => {
      pty.killed = true;
      order.push("kill");
      queueMicrotask(() => pty.onExitHandler?.({ exitCode: 0 }));
    };
    const cleanupAgentWorktree = vi.fn(async (request: { branchName: string; force?: boolean }): Promise<void> => {
      order.push(`cleanup ${request.branchName} force=${request.force}`);
    });
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(pty) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-live",
        cwd: path.join(managedProjectWorktreeRoot("/alfred/userData/worktrees", "/repo"), "alfred-codex-live"),
      }),
    });
    await invoke(terminalChannels.create, {
      agentKind: "codex",
      clientId: "codex-live",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
    });

    await expect(invoke(terminalChannels.forget, {
      clientId: "codex-live",
      cleanupWorktree: true,
    })).resolves.toEqual({ ok: true });

    expect(order).toEqual(["kill", "cleanup alfred-codex-live force=true"]);
    expect((await invoke<TerminalListResult>(terminalChannels.list)).sessions).toHaveLength(0);
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([]);
  });

  it("reports the project's uncommitted files when it makes a checkout from the last commit", async () => {
    registerTerminalIpc({
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
      prepareAgentWorktree: async () => ({
        baseCwd: "/repo",
        branchName: "alfred-codex-dirty",
        cwd: "/alfred/userData/worktrees/dirty",
        uncommittedFiles: 2,
      }),
    });

    await expect(invoke(terminalChannels.create, {
      agentKind: "codex",
      clientId: "codex-dirty",
      command: "codex",
      cols: 80,
      cwd: "/repo",
      isolation: "worktree",
      rows: 24,
    })).resolves.toMatchObject({ clientId: "codex-dirty", uncommittedFiles: 2 });
  });

  it("rejects Discard for a live session that is not a checkout, without cleanup or metadata loss", async () => {
    const cleanupAgentWorktree = vi.fn(async (): Promise<void> => undefined);
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty: async () => fakeNodePty(new FakePty()) as never,
    });
    await invoke(terminalChannels.create, {
      clientId: "live",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    });

    await expect(invoke(terminalChannels.forget, {
      clientId: "live",
      cleanupWorktree: true,
    })).resolves.toEqual({
      ok: false,
      error: "Close the live session before discarding its checkout.",
    });
    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
    expect((await invoke<TerminalListResult>(terminalChannels.list)).sessions).toHaveLength(1);
  });

  it("rejects Forget while a create holds the client lifecycle reservation", async () => {
    const loadPty = deferred<ReturnType<typeof fakeNodePty>>();
    const loadNodePty = vi.fn(async () => loadPty.promise as never);
    const cleanupAgentWorktree = vi.fn(async (): Promise<void> => undefined);
    configureTerminalPersistence(storeWithRestoredSessions([{
      clientId: "racing-client",
      title: "Racing checkout",
      source: "alfred",
      agentKind: "codex",
      isolation: "worktree",
      branchName: "alfred-codex-racing",
      baseCwd: "/repo",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-racing",
    }]), { debounceMs: 0 });
    registerTerminalIpc({ cleanupAgentWorktree, loadNodePty });

    const creating = invoke(terminalChannels.create, {
      clientId: "racing-client",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    });
    await vi.waitFor(() => expect(loadNodePty).toHaveBeenCalledOnce());

    await expect(invoke(terminalChannels.forget, {
      clientId: "racing-client",
      cleanupWorktree: true,
    })).resolves.toEqual({
      ok: false,
      error: "Session lifecycle operation is already in progress.",
    });
    expect(cleanupAgentWorktree).not.toHaveBeenCalled();

    loadPty.resolve(fakeNodePty(new FakePty()));
    await expect(creating).resolves.toEqual(expect.objectContaining({ clientId: "racing-client" }));
  });

  it("blocks create, prepare, and duplicate Forget while cleanup owns the client lifecycle", async () => {
    const cleanup = deferred<void>();
    const cleanupAgentWorktree = vi.fn(() => cleanup.promise);
    const loadNodePty = vi.fn(async () => fakeNodePty(new FakePty()) as never);
    configureTerminalPersistence(storeWithRestoredSessions([{
      clientId: "racing-client",
      title: "Racing checkout",
      source: "alfred",
      agentKind: "codex",
      isolation: "worktree",
      branchName: "alfred-codex-racing",
      baseCwd: "/repo",
      cwd: "/alfred/userData/worktrees/repo-816fc349/alfred-codex-racing",
    }]), { debounceMs: 0 });
    registerTerminalIpc({
      cleanupAgentWorktree,
      loadNodePty,
      managedWorktreeRootPath: "/alfred/userData/worktrees",
    });

    const forgetting = invoke(terminalChannels.forget, {
      clientId: "racing-client",
      cleanupWorktree: true,
    });
    await vi.waitFor(() => expect(cleanupAgentWorktree).toHaveBeenCalledOnce());

    await expect(invoke(terminalChannels.create, {
      clientId: "racing-client",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    })).rejects.toThrow("Session lifecycle operation is already in progress.");
    await expect(invoke(terminalChannels.prepareLaunch, {
      clientId: "racing-client",
      cols: 80,
      cwd: "/repo",
      rows: 24,
    })).rejects.toThrow("Session lifecycle operation is already in progress.");
    await expect(invoke(terminalChannels.forget, {
      clientId: "racing-client",
      cleanupWorktree: true,
    })).resolves.toEqual({
      ok: false,
      error: "Session lifecycle operation is already in progress.",
    });
    expect(loadNodePty).not.toHaveBeenCalled();

    cleanup.resolve();
    await expect(forgetting).resolves.toEqual({ ok: true });
  });

  it("rejects Forget while a restored launch ticket reserves the client id", async () => {
    const snapshot: PersistedTerminalSessionSnapshot = {
      clientId: "prepared-client",
      title: "Prepared recovery",
      source: "manual",
      cwd: "/repo",
      shell: "/bin/sh",
      command: "/bin/sh",
      args: ["-c", "/usr/bin/printf prepared\\n"],
    };
    const nodePty = fakeNodePty(new FakePty());
    configureTerminalPersistence(storeWithRestoredSessions([snapshot]), { debounceMs: 0 });
    registerTerminalIpc({
      isStagedCommandAllowed: async () => false,
      loadNodePty: async () => nodePty as never,
      requireLaunchTickets: true,
    });
    const request: TerminalCreateRequest = {
      clientId: snapshot.clientId,
      ...(snapshot.command === undefined ? {} : { command: snapshot.command }),
      ...(snapshot.args === undefined ? {} : { args: snapshot.args }),
      cols: 80,
      ...(snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd }),
      rows: 24,
      source: "manual",
    };

    const prepared = await invoke<{ launchTicketId: string }>(terminalChannels.prepareLaunch, request);
    await expect(invoke(terminalChannels.forget, {
      clientId: snapshot.clientId,
      cleanupWorktree: true,
    })).resolves.toEqual({
      ok: false,
      error: "Session lifecycle operation is already in progress.",
    });

    await expect(invoke(terminalChannels.create, {
      ...request,
      launchTicketId: prepared.launchTicketId,
    })).resolves.toEqual(expect.objectContaining({ clientId: snapshot.clientId }));
  });

  it("forgets shared recovery non-destructively without resolving a workspace root", async () => {
    const resolveWorkspaceRoot = vi.fn(async () => "/repo");
    const cleanupAgentWorktree = vi.fn(async (): Promise<void> => undefined);
    configureTerminalPersistence(storeWithRestoredSessions([{
      clientId: "shared",
      title: "Shared recovery",
      source: "manual",
      workspaceId: "A",
      isolation: "shared",
    }]), { debounceMs: 0 });
    registerTerminalIpc({ cleanupAgentWorktree, resolveWorkspaceRoot });

    await expect(invoke(terminalChannels.forget, {
      clientId: "shared",
      cleanupWorktree: true,
    })).resolves.toEqual({ ok: true });
    expect(resolveWorkspaceRoot).not.toHaveBeenCalled();
    expect(cleanupAgentWorktree).not.toHaveBeenCalled();
    expect((await invoke<TerminalListResult>(terminalChannels.list)).restoredSessions).toEqual([]);
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
      ...persistedStateStoreMethods(() => state),
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
    await expect(invoke(terminalChannels.forget, {
      clientId: "codex-1",
      cleanupWorktree: true,
    })).resolves.toEqual({ ok: true });

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
      ...persistedStateStoreMethods(() => state),
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
    await expect(invoke(terminalChannels.forget, {
      clientId: "codex-legacy",
      cleanupWorktree: true,
    })).resolves.toEqual({ ok: true });

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
      ...persistedStateStoreMethods(() => state),
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
    await expect(invoke(terminalChannels.forget, {
      clientId: "codex-shared",
      cleanupWorktree: true,
    })).resolves.toEqual({ ok: true });

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
      applied: false,
      patch: "diff --git a/src/app.tsx b/src/app.tsx\n--- a/src/app.tsx\n+++ b/src/app.tsx",
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
      applied: false,
      patch: "diff --git a/src/app.tsx b/src/app.tsx\n--- a/src/app.tsx\n+++ b/src/app.tsx",
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
      ...persistedStateStoreMethods(() => state),
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
      ...persistedStateStoreMethods(() => state),
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
      ...persistedStateStoreMethods(() => state),
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
      ...persistedStateStoreMethods(() => state),
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
    await expect(invoke(terminalChannels.forget, {
      clientId: "codex-1",
      cleanupWorktree: true,
    })).resolves.toEqual({
      ok: false,
      error: "Isolated checkout metadata is not safe.",
    });

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
      [...CODEX_NOTIFICATION_ARGS, "Review the backend"],
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

  it("ignores a write that carries no text", async () => {
    const pty = new FakePty();
    registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
    const created = await invoke<{ id: string }>(terminalChannels.create, { command: "node", cols: 80, cwd: "/repo", rows: 24 });

    emit(terminalChannels.write, { id: created.id, data: 42 });
    emit(terminalChannels.write, null);

    expect(pty.writes).toEqual([]);
  });

  it("rejects live isolated checkout operations from a different window even when a snapshot exists", async () => {
    const ownerWindow = fakeWindow(1);
    const otherWindow = fakeWindow(2);
    liveWindows = [ownerWindow, otherWindow];
    const ownerSender = senderFor(ownerWindow);
    const otherSender = senderFor(otherWindow);
    const pty = new FakePty();
    const inspectAgentWorktree = vi.fn(async () => ({ summary: "1 changed file", files: [], patch: "", applied: false }));
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

    await expect(invoke(terminalChannels.forget, {
      clientId: "codex-1",
      cleanupWorktree: true,
    }, otherSender)).resolves.toEqual({ ok: false, error: "Session not found." });

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
      payload: { id: created.id, data: "after reattach\n", activities: [], at: expect.any(Number) },
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

  describe("agent state signals", () => {
    type Listener = (
      sessionId: string,
      update: { activity?: SessionActivityInput; answer?: string; detail?: string; state: "working" | "needs-you" | "your-turn" },
      transcriptPath?: string,
      conversationId?: string,
    ) => void;

    type ToolHandler = (sessionId: string, tool: string, args: unknown) => Promise<unknown>;

    function fakeBridge() {
      let listener: Listener | null = null;
      let toolHandler: ToolHandler | null = null;
      return {
        bridge: {
          close: async () => {},
          env: (sessionId: string) => ({ ALFRED_HOOK_SOCKET: "/tmp/alfred.sock", ALFRED_SESSION_ID: sessionId }),
          launchArgs: vi.fn((command: string | undefined, _session?: { id: string; worker: boolean }) =>
            command === "claude" ? ["--settings", "/tmp/hooks.json"] : command === "codex" ? ["-c", "tui.notifications=true"] : []),
          setListener: (next: Listener | null) => {
            listener = next;
          },
          setToolHandler: (next: ToolHandler | null) => {
            toolHandler = next;
          },
        },
        fire: (sessionId: string, update: Parameters<Listener>[1], transcriptPath?: string, conversationId?: string) =>
          listener?.(sessionId, update, transcriptPath, conversationId),
        callTool: (sessionId: string, tool: string, args: unknown) => toolHandler!(sessionId, tool, args),
      };
    }

    const lastDataEvent = () => sentEvents.filter((event) => event.channel === terminalChannels.data).at(-1)?.payload as
      | Record<string, unknown>
      | undefined;

    it("launches Claude with hooks and turns hook events into signals that input can clear", async () => {
      const { bridge, fire } = fakeBridge();
      const pty = new FakePty();
      const nodePty = fakeNodePty(pty);
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => nodePty as never });

      const created = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "claude",
        args: ["--resume"],
        clientId: "claude-1",
        cols: 80,
        command: "claude",
        cwd: "/repo",
        rows: 24,
      });

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "claude",
        ["--settings", "/tmp/hooks.json", "--resume"],
        expect.objectContaining({
          env: expect.objectContaining({ ALFRED_HOOK_SOCKET: "/tmp/alfred.sock", ALFRED_SESSION_ID: created.id }),
        }),
      );

      fire(created.id, { state: "needs-you", detail: "Bash: ls" });
      expect(lastDataEvent()).toMatchObject({
        data: "",
        agentSignal: { state: "needs-you", source: "hook", detail: "Bash: ls" },
        activities: [expect.objectContaining({ kind: "approval", detail: "Bash: ls" })],
      });

      // Your answer also settles the prompt, so the quiet that follows does not read as a prompt left waiting.
      emit(terminalChannels.write, { id: created.id, data: "\r" });
      expect(lastDataEvent()).toMatchObject({
        data: "",
        agentSignal: null,
        activities: [expect.objectContaining({ kind: "lifecycle", title: "Prompt answered" })],
      });

      fire(created.id, { state: "your-turn" });
      emit(terminalChannels.write, { id: created.id, data: "h" });
      expect(lastDataEvent()).toMatchObject({ agentSignal: { state: "your-turn", source: "hook" } });

      // The answer a turn ended with takes the approval's place as the latest activity.
      fire(created.id, { state: "your-turn", detail: "Created hello world.txt on the desktop." });
      expect(lastDataEvent()).toMatchObject({
        agentSignal: { state: "your-turn", source: "hook", detail: "Created hello world.txt on the desktop." },
        activities: [expect.objectContaining({ kind: "output", detail: "Created hello world.txt on the desktop." })],
      });
    });

    it("remembers the conversation an agent's hooks name, so Resume can reopen that one", async () => {
      const first = "6f1c2a4e-8b1d-4c3e-9f2a-0d5e7b8c9a10";
      const second = "7a2d3b5f-9c2e-4d4f-8a3b-1e6f8c9dab21";
      let state: DesktopStateSnapshot = { ...DEFAULT_DESKTOP_STATE, restoredTerminalSessions: [] };
      const store: PersistedDesktopStateStore = {
        ...persistedStateStoreMethods(() => state),
        getState: vi.fn(async () => state),
        setState: vi.fn(async (next) => { state = next; return state; }),
        updateState: vi.fn(async (updater) => { state = await updater(state); return state; }),
      };
      configureTerminalPersistence(store, { debounceMs: 0 });
      const { bridge, fire } = fakeBridge();
      const nodePty = { spawn: vi.fn(() => new FakePty()) };
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => nodePty as never });
      const claude = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "claude", clientId: "claude-1", cols: 80, command: "claude", cwd: "/repo", rows: 24,
      });
      const shell = await invoke<{ id: string }>(terminalChannels.create, { clientId: "shell-1", cols: 80, cwd: "/repo", rows: 24 });

      fire(claude.id, { state: "your-turn" }, undefined, first);
      expect(lastDataEvent()).toMatchObject({ resumeTarget: { agentKind: "claude", sessionId: first, source: "agent-hook" } });
      await flushTerminalPersistence();
      expect(state.restoredTerminalSessions.find((session) => session.clientId === "claude-1")?.resumeTarget)
        .toEqual({ agentKind: "claude", sessionId: first, source: "agent-hook" });

      // /clear starts another conversation in the same terminal; the newest one is the one to resume.
      fire(claude.id, { state: "your-turn" }, undefined, second);
      await flushTerminalPersistence();
      expect(state.restoredTerminalSessions.find((session) => session.clientId === "claude-1")?.resumeTarget?.sessionId).toBe(second);

      // The same conversation again is not news.
      fire(claude.id, { state: "working" }, undefined, second);
      expect(lastDataEvent()).not.toHaveProperty("resumeTarget");

      // A shell is not an agent, whatever reaches its socket.
      fire(shell.id, { state: "your-turn" }, undefined, first);
      expect(lastDataEvent()).not.toHaveProperty("resumeTarget");
    });

    it("adds an orchestrator's worker through its window and answers its tools from the worker's hooks", async () => {
      const { bridge, fire, callTool } = fakeBridge();
      const leadPty = new FakePty();
      const workerPty = new FakePty();
      const nodePty = { spawn: vi.fn().mockReturnValueOnce(leadPty).mockReturnValueOnce(workerPty) };
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => nodePty as never });
      const lead = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "claude", clientId: "claude-1", cols: 80, command: "claude", cwd: "/repo", rows: 24,
      });
      expect(bridge.launchArgs).toHaveBeenLastCalledWith("claude", { id: lead.id, worker: false });

      // The window adds the worker under its parent and answers; the worker's terminal starts after that.
      const starting = callTool(lead.id, "start_worker", { agent: "codex", prompt: "Run the typecheck" });
      const request = sentEvents.find((event) => event.channel === terminalChannels.workerRequest)?.payload as TerminalWorkerRequest;
      expect(request).toMatchObject({ parentClientId: "claude-1", agent: "codex", prompt: "Run the typecheck", isolated: false });
      emit(terminalChannels.workerReply, { requestId: request.requestId, clientId: "codex-1", title: "Codex" });
      await expect(starting).resolves.toEqual({ worker_id: "codex-1", title: "Codex", state: "starting" });
      await expect(callTool(lead.id, "list_workers", {})).resolves.toEqual({
        workers: [{ worker_id: "codex-1", title: "Codex", agent: "codex", state: "starting" }],
      });

      const worker = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "codex", args: ["--", "Run the typecheck"], clientId: "codex-1", cols: 80, command: "codex", cwd: "/repo",
        parentClientId: "claude-1", rows: 24, title: "Codex",
      });
      expect(bridge.launchArgs).toHaveBeenLastCalledWith("codex", { id: worker.id, worker: true });
      await expect(callTool(worker.id, "list_workers", {})).rejects.toThrow(/cannot start or run workers/);

      // A Codex notification alone cannot tell its prompt from an approval menu, where Enter would answer.
      workerPty.onDataHandler?.("\x1b]9;Typecheck passed\x07");
      await expect(callTool(lead.id, "read_worker", { worker_id: "codex-1" })).resolves.toMatchObject({ state: "your turn" });
      await expect(callTool(lead.id, "send_to_worker", { worker_id: "codex-1", message: "Next" })).rejects.toThrow(/does not run Alfred's hooks/);
      expect(workerPty.writes).toEqual([]);

      fire(worker.id, { state: "working" });
      const waiting = callTool(lead.id, "wait_for_worker", { worker_id: "codex-1" });
      fire(worker.id, { state: "your-turn", detail: "Typecheck passed.", answer: "Typecheck passed.\nNo errors." });
      await expect(waiting).resolves.toMatchObject({ state: "your turn", last_answer: "Typecheck passed.\nNo errors." });

      // Pasted as typed text: an escape or a Ctrl+C inside the message cannot end the paste or press a key.
      await expect(callTool(lead.id, "send_to_worker", { worker_id: "codex-1", message: "Now lint\x1b[201~\x03 it\r\nthanks" }))
        .resolves.toEqual({ worker_id: "codex-1", sent: true, state: "working" });
      const labelled = '\x1b[200~Message from your orchestrator, Alfred session "Manual terminal" (not from the user):\n\nNow lint[201~ it\nthanks\x1b[201~';
      expect(workerPty.writes).toEqual([labelled]);
      await vi.waitFor(() => expect(workerPty.writes).toEqual([labelled, "\r"]));
      await expect(callTool(lead.id, "send_to_worker", { worker_id: "codex-1", message: "Again" })).rejects.toThrow(/is working/);

      workerPty.onExitHandler?.({ exitCode: 0 });
      await expect(callTool(lead.id, "list_workers", {})).resolves.toMatchObject({
        workers: [{ worker_id: "codex-1", state: "ended", last_answer: "Typecheck passed.\nNo errors." }],
      });
    });

    it("tells the orchestrator when its window does not add the worker", async () => {
      const { bridge, callTool } = fakeBridge();
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => fakeNodePty(new FakePty()) as never });
      const lead = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "claude", clientId: "claude-1", cols: 80, command: "claude", cwd: "/repo", rows: 24,
      });
      const refused = callTool(lead.id, "start_worker", { agent: "claude", prompt: "x" });
      const request = sentEvents.find((event) => event.channel === terminalChannels.workerRequest)?.payload as TerminalWorkerRequest;
      emit(terminalChannels.workerReply, { requestId: request.requestId, error: "The project folder is missing." });
      await expect(refused).rejects.toThrow("The project folder is missing.");

      vi.useFakeTimers();
      try {
        const unanswered = callTool(lead.id, "start_worker", { agent: "claude", prompt: "x" });
        const settled = expect(unanswered).rejects.toThrow(/did not answer in time/);
        await vi.advanceTimersByTimeAsync(10_000);
        await settled;
      } finally {
        vi.useRealTimers();
      }
      await expect(callTool(lead.id, "list_workers", {})).resolves.toEqual({ workers: [] });
    });

    async function orchestratorWithWorkers(count: number) {
      const { bridge, fire, callTool } = fakeBridge();
      const leadPty = new FakePty();
      const workerPtys = Array.from({ length: count }, () => new FakePty());
      const spawn = vi.fn(() => new FakePty()).mockReturnValueOnce(leadPty);
      for (const pty of workerPtys) spawn.mockReturnValueOnce(pty);
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => ({ spawn }) as never });
      const lead = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "claude", clientId: "claude-1", cols: 80, command: "claude", cwd: "/repo", rows: 24, title: "Lead",
      });
      const workers: Array<{ id: string; clientId: string }> = [];
      for (let index = 1; index <= count; index += 1) {
        const starting = callTool(lead.id, "start_worker", { agent: "codex", prompt: `Task ${index}` });
        const request = sentEvents.filter((event) => event.channel === terminalChannels.workerRequest).at(-1)!.payload as TerminalWorkerRequest;
        emit(terminalChannels.workerReply, { requestId: request.requestId, clientId: `codex-${index}`, title: `Task ${index}` });
        await starting;
        const created = await invoke<{ id: string }>(terminalChannels.create, {
          agentKind: "codex", clientId: `codex-${index}`, cols: 80, command: "codex", cwd: "/repo", parentClientId: "claude-1", rows: 24,
          title: `Task ${index}`,
        });
        workers.push({ id: created.id, clientId: `codex-${index}` });
      }
      // The orchestrator handed the work out and ended its turn: it waits for the user.
      fire(lead.id, { state: "working" });
      fire(lead.id, { state: "your-turn", detail: "Started two workers." });
      return { bridge, fire, callTool, lead, leadPty, spawn, workers, workerPtys };
    }

    it("sends nothing to a worker whose terminal you started typing in", async () => {
      const { fire, callTool, lead, workers, workerPtys } = await orchestratorWithWorkers(1);
      fire(workers[0]!.id, { state: "working" });
      fire(workers[0]!.id, { state: "your-turn", detail: "Done." });
      emit(terminalChannels.write, { id: workers[0]!.id, data: "half a sent" });

      // Pasted after your half sentence, its message would go to the worker as one with yours.
      await expect(callTool(lead.id, "send_to_worker", { worker_id: "codex-1", message: "Now run the lint" }))
        .rejects.toThrow(/typing in this worker's terminal/);
      expect(workerPtys[0]!.writes).toEqual(["half a sent"]);

      // You sent yours and the worker answered it: the orchestrator's message can go.
      emit(terminalChannels.write, { id: workers[0]!.id, data: "ence\r" });
      fire(workers[0]!.id, { state: "working" });
      fire(workers[0]!.id, { state: "your-turn", detail: "Answered." });
      await expect(callTool(lead.id, "send_to_worker", { worker_id: "codex-1", message: "Now run the lint" }))
        .resolves.toMatchObject({ sent: true });
    });

    it("releases an orchestrator's workers when you close it, so a new session under its id does not get them", async () => {
      vi.useFakeTimers();
      try {
        const store = storeWithRestoredSessions([]);
        configureTerminalPersistence(store, { debounceMs: 0 });
        const { fire, callTool, lead, spawn, workers, workerPtys } = await orchestratorWithWorkers(2);
        // One worker ended while its orchestrator ran; the other still runs and has news waiting.
        workerPtys[1]!.onExitHandler?.({ exitCode: 0 });
        fire(workers[0]!.id, { state: "working" });
        emit(terminalChannels.write, { id: lead.id, data: "draft" });
        fire(workers[0]!.id, { state: "your-turn", detail: "Done." });

        emit(terminalChannels.kill, { id: lead.id });
        const next = await invoke<{ id: string }>(terminalChannels.create, {
          agentKind: "claude", clientId: "claude-1", cols: 80, command: "claude", cwd: "/repo", rows: 24, title: "New",
        });
        const nextPty = spawn.mock.results.at(-1)!.value as FakePty;
        fire(next.id, { state: "your-turn", detail: "Ready." });

        await expect(callTool(next.id, "list_workers", {})).resolves.toEqual({ workers: [] });
        fire(workers[0]!.id, { state: "working" });
        fire(workers[0]!.id, { state: "your-turn", detail: "Again." });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(nextPty.writes).toEqual([]);
        // The worker that still runs is a session of its own now.
        await expect(callTool(workers[0]!.id, "list_workers", {})).resolves.toEqual({ workers: [] });
        await flushTerminalPersistence();
        expect((await store.getState()).restoredTerminalSessions.find((session) => session.clientId === "codex-1"))
          .not.toHaveProperty("parentClientId");
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps an orchestrator's workers when Alfred quits, for after the restart", async () => {
      const store = storeWithRestoredSessions([]);
      configureTerminalPersistence(store, { debounceMs: 0 });
      await orchestratorWithWorkers(1);

      killAllTerminalSessions();
      await flushTerminalPersistence();

      expect((await store.getState()).restoredTerminalSessions.find((session) => session.clientId === "codex-1"))
        .toMatchObject({ parentClientId: "claude-1" });
    });

    it("releases the asleep workers of an asleep orchestrator you close", async () => {
      const asleep = (clientId: string, extra: Partial<PersistedTerminalSessionSnapshot> = {}): PersistedTerminalSessionSnapshot => ({
        clientId, title: clientId, source: "manual", cwd: "/repo", shell: "codex", buffer: "", ...extra,
      });
      const store = storeWithRestoredSessions([
        asleep("claude-1", { agentKind: "claude", command: "claude" }),
        asleep("codex-1", { agentKind: "codex", command: "codex", parentClientId: "claude-1" }),
      ]);
      configureTerminalPersistence(store, { debounceMs: 0 });
      registerTerminalIpc();

      await expect(invoke(terminalChannels.forget, { clientId: "claude-1" })).resolves.toEqual({ ok: true });
      await flushTerminalPersistence();

      const sessions = (await store.getState()).restoredTerminalSessions;
      expect(sessions.map((session) => session.clientId)).toEqual(["codex-1"]);
      expect(sessions[0]).not.toHaveProperty("parentClientId");
    });

    it("wakes an orchestrator that waits for the user once its workers finish, in one message", async () => {
      vi.useFakeTimers();
      try {
        const { fire, lead, leadPty, workers } = await orchestratorWithWorkers(2);
        fire(workers[0]!.id, { state: "working" });
        fire(workers[0]!.id, { state: "your-turn", detail: "Typecheck passed.", answer: "Typecheck passed.\nNo errors." });
        await vi.advanceTimersByTimeAsync(1_000);
        fire(workers[1]!.id, { state: "your-turn", detail: "Lint is clean." });
        expect(leadPty.writes).toEqual([]);
        await vi.advanceTimersByTimeAsync(2_000);
        // Which workers changed, not what they wrote: their answers come through read_worker, as tool results.
        expect(leadPty.writes).toEqual([
          "\x1b[200~Message from Alfred (not from the user): 2 of your workers changed.\n"
            + '- "Task 1" (codex-1) finished its turn.\n'
            + '- "Task 2" (codex-2) finished its turn.\n'
            + "Read their answers with read_worker; send_to_worker gives a worker its next message.\x1b[201~",
        ]);
        expect(leadPty.writes[0]).not.toContain("Typecheck passed");
        await vi.advanceTimersByTimeAsync(200);
        expect(leadPty.writes.at(-1)).toBe("\r");
        // Woken, it is working; nothing more is typed until its next turn ends.
        fire(workers[0]!.id, { state: "your-turn", detail: "Again." });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(leadPty.writes).toHaveLength(2);
        fire(lead.id, { state: "your-turn", detail: "Both done." });
        await vi.advanceTimersByTimeAsync(2_200);
        expect(leadPty.writes.at(-2)).toContain('your worker "Task 1" (codex-1) finished its turn.');
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not wake an orchestrator whose draft you are typing, asking for approval, or that read the news", async () => {
      vi.useFakeTimers();
      try {
        const { fire, callTool, lead, leadPty, workers } = await orchestratorWithWorkers(1);
        // You started typing to it: Alfred's Enter would send your half-written message.
        emit(terminalChannels.write, { id: lead.id, data: "plea" });
        fire(workers[0]!.id, { state: "your-turn", detail: "Done." });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(leadPty.writes).toEqual(["plea"]);

        // You sent it; it worked and ended its turn: now the news goes, once.
        emit(terminalChannels.write, { id: lead.id, data: "se\r" });
        fire(lead.id, { state: "working" });
        fire(lead.id, { state: "your-turn", detail: "Answered you." });
        await vi.advanceTimersByTimeAsync(2_200);
        expect(leadPty.writes.filter((write) => write.includes("Message from Alfred"))).toHaveLength(1);

        // Asking you for approval, it is not woken.
        fire(lead.id, { state: "working" });
        fire(lead.id, { state: "needs-you", detail: "Bash: rm -rf dist" });
        fire(workers[0]!.id, { state: "working" });
        fire(workers[0]!.id, { state: "your-turn", detail: "Again." });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(leadPty.writes.filter((write) => write.includes("Message from Alfred"))).toHaveLength(1);

        // It read the worker itself before its turn ended, so there is no news left.
        await callTool(lead.id, "read_worker", { worker_id: "codex-1" });
        fire(lead.id, { state: "your-turn", detail: "Done." });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(leadPty.writes.filter((write) => write.includes("Message from Alfred"))).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops a worker for its orchestrator without waking it about that", async () => {
      vi.useFakeTimers();
      try {
        const { callTool, lead, leadPty, workerPtys } = await orchestratorWithWorkers(1);
        await expect(callTool(lead.id, "stop_worker", { worker_id: "codex-1" })).resolves.toEqual({ worker_id: "codex-1", stopped: true });
        expect(workerPtys[0]!.killed).toBe(true);
        workerPtys[0]!.onExitHandler?.({ exitCode: 0 });
        expect(sentEvents.some((event) => event.channel === terminalChannels.exit)).toBe(true);
        await expect(callTool(lead.id, "read_worker", { worker_id: "codex-1" })).resolves.toMatchObject({
          state: "ended",
          recent_steps: expect.arrayContaining(["Its orchestrator stopped this worker."]),
        });
        await vi.advanceTimersByTimeAsync(3_000);
        expect(leadPty.writes).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("takes a hooked agent's history from its hooks, not from the screen it redraws", async () => {
      const { bridge, fire } = fakeBridge();
      const pty = new FakePty();
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => fakeNodePty(pty) as never });
      const created = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "claude", clientId: "claude-1", cols: 80, command: "claude", cwd: "/repo", rows: 24,
      });
      emit(terminalChannels.write, { id: created.id, data: "fix the build\r" });

      fire(created.id, {
        state: "working",
        activity: { kind: "command", title: "Ran command", detail: "pnpm test", payload: { type: "command", command: "pnpm test" } },
      });
      expect(lastDataEvent()).toMatchObject({
        data: "",
        agentSignal: { state: "working", source: "hook" },
        activities: [expect.objectContaining({ kind: "command", detail: "pnpm test" })],
      });

      // Scrolling back through its transcript, Claude redraws tool lines and old errors; none of it is new work.
      fire(created.id, { state: "your-turn", detail: "Done." });
      pty.onDataHandler?.("⏺ Update(src/app.tsx)\n  ⎿  Updated with 3 additions\nBash(\"pnpm test\")\nError: old failure\n");
      expect(lastDataEvent()).toMatchObject({ activities: [] });
      // A blocker it prints still counts: it is why the session needs you.
      pty.onDataHandler?.("Not logged in · Please run /login\n");
      expect(lastDataEvent()).toMatchObject({
        activities: [expect.objectContaining({ kind: "error", title: "Runtime blocked" })],
      });
    });

    it("keeps a hooked Codex at Your turn while you type, after its notification repeats the turn end", async () => {
      const { bridge, fire } = fakeBridge();
      const pty = new FakePty();
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => fakeNodePty(pty) as never });
      const created = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "codex", clientId: "codex-1", cols: 80, command: "codex", cwd: "/repo", rows: 24,
      });
      fire(created.id, { state: "your-turn", detail: "Done." });
      pty.onDataHandler?.("\x1b]9;Done.\x07");

      emit(terminalChannels.write, { id: created.id, data: "n" });

      const listed = await invoke<TerminalListResult>(terminalChannels.list);
      expect(listed.sessions[0]?.agentSignal).toMatchObject({ state: "your-turn", source: "hook" });
    });

    it("takes only blockers from an agent's screen until you send it a message", async () => {
      const { bridge } = fakeBridge();
      const pty = new FakePty();
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => fakeNodePty(pty) as never });
      const created = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "codex", clientId: "codex-1", cols: 80, command: "codex", cwd: "/repo", rows: 24,
      });

      // A resumed conversation is drawn again before anything new happens.
      pty.onDataHandler?.("Bash(\"pnpm test\")\nError: old failure\n");
      expect(lastDataEvent()).toMatchObject({ activities: [] });
      pty.onDataHandler?.("MCP server github failed to start: interrupted\n");
      expect(lastDataEvent()).toMatchObject({ activities: [expect.objectContaining({ kind: "error", title: "Runtime blocked" })] });

      // Without hooks (a Codex whose hooks are not trusted), its screen stays the only record once you have written to it.
      emit(terminalChannels.write, { id: created.id, data: "run the tests\r" });
      pty.onDataHandler?.("Bash(\"pnpm test\")\n");
      expect(lastDataEvent()).toMatchObject({ activities: [expect.objectContaining({ kind: "command" })] });
    });

    it("reads Codex OSC 9 notifications that only your input clears, not the terminal's own reports", async () => {
      const { bridge } = fakeBridge();
      const pty = new FakePty();
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => fakeNodePty(pty) as never });
      const created = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "codex",
        clientId: "codex-1",
        cols: 80,
        command: "codex",
        cwd: "/repo",
        rows: 24,
      });

      pty.onDataHandler?.("working\x1b]9;Approval requested: /bin/zsh -lc 'ls'\x07");
      expect(lastDataEvent()).toMatchObject({
        agentSignal: { state: "needs-you", source: "osc9", detail: "Approval requested: /bin/zsh -lc 'ls'" },
      });

      // Clicking into the terminal and out again, or moving the mouse over it while Codex tracks the mouse,
      // still reaches Codex, but it is not an answer.
      emit(terminalChannels.write, { id: created.id, data: "\x1b[I" });
      emit(terminalChannels.write, { id: created.id, data: "\x1b[<35;40;12M" });
      emit(terminalChannels.write, { id: created.id, data: "\x1b[<0;40;12M\x1b[<0;40;12m" });
      emit(terminalChannels.write, { id: created.id, data: "\x1b[O" });
      expect(lastDataEvent()).toMatchObject({ agentSignal: { state: "needs-you", source: "osc9" } });

      // Declining with Esc answers it too.
      emit(terminalChannels.write, { id: created.id, data: "\x1b" });
      expect(lastDataEvent()).toMatchObject({
        data: "",
        agentSignal: null,
        activities: [expect.objectContaining({ kind: "lifecycle", title: "Prompt answered" })],
      });
      expect(pty.writes).toEqual(["\x1b[I", "\x1b[<35;40;12M", "\x1b[<0;40;12M\x1b[<0;40;12m", "\x1b[O", "\x1b"]);
      // Further input has nothing left to answer.
      const events = sentEvents.length;
      emit(terminalChannels.write, { id: created.id, data: "y" });
      expect(sentEvents.slice(events).filter((event) => event.channel === terminalChannels.data)).toEqual([]);
    });

    it("tells the window once that you sent the session a message, not when the terminal reports", async () => {
      const { bridge } = fakeBridge();
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => fakeNodePty(new FakePty()) as never });
      const created = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "codex", clientId: "codex-1", cols: 80, command: "codex", cwd: "/repo", rows: 24,
      });
      const promptEvents = () =>
        sentEvents.filter((event) => event.channel === terminalChannels.data && (event.payload as Record<string, unknown>).promptSubmitted);

      // A focus report and a colour reply are the terminal talking, and typing alone sends nothing yet.
      emit(terminalChannels.write, { id: created.id, data: "\x1b[I" });
      emit(terminalChannels.write, { id: created.id, data: "\x1b]11;rgb:1010/1010/1010\x1b\\" });
      emit(terminalChannels.write, { id: created.id, data: "fix the build" });
      expect(promptEvents()).toEqual([]);

      emit(terminalChannels.write, { id: created.id, data: "\r" });
      emit(terminalChannels.write, { id: created.id, data: "and the tests\r" });
      expect(promptEvents()).toHaveLength(1);
      expect(promptEvents()[0]?.payload).toMatchObject({ data: "", promptSubmitted: true });
      const listed = await invoke<TerminalListResult>(terminalChannels.list);
      expect(listed.sessions.find((session) => session.id === created.id)).toMatchObject({ promptSubmitted: true });
    });

    it("finds the file behind a Codex [Image #1] in the rollout its hooks name", async () => {
      const { bridge, fire } = fakeBridge();
      registerTerminalIpc({ agentSignals: bridge, loadNodePty: async () => fakeNodePty(new FakePty()) as never });
      const codex = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "codex", clientId: "codex-1", cols: 80, command: "codex", cwd: "/repo", rows: 24,
      });
      const claude = await invoke<{ id: string }>(terminalChannels.create, {
        agentKind: "claude", clientId: "claude-1", cols: 80, command: "claude", cwd: "/repo", rows: 24,
      });
      const rolloutDir = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-rollout-"));
      onTestFinished(() => fs.rm(rolloutDir, { recursive: true, force: true }));
      const rollout = path.join(rolloutDir, "rollout.jsonl");
      const content = [
        { type: "input_text", text: '<image name=[Image #1] path="/Users/p/Desktop/shot.png">' },
        { type: "input_text", text: "</image>" },
        { type: "input_text", text: "[Image #1] look" },
      ];
      const item = { type: "UserMessage", content: [{ type: "local_image", path: "/Users/p/Desktop/shot.png" }, { type: "text", text: "[Image #1] look" }] };
      await fs.writeFile(
        rollout,
        `${JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content } })}\n`
          + `${JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item } })}\n`,
      );
      const request = { clientId: "codex-1", messages: ["[Image #1] look"], index: 0 };

      // Before any hook there is no rollout to read.
      await expect(invoke(terminalChannels.codexImages, request)).resolves.toEqual({ images: {} });
      fire(codex.id, { state: "working" }, rollout);
      fire(claude.id, { state: "working" }, rollout);
      await expect(invoke(terminalChannels.codexImages, request)).resolves.toEqual({
        images: { "[Image #1]": "/Users/p/Desktop/shot.png" },
      });
      // Claude links its own images, so only Codex sessions are looked up.
      await expect(invoke(terminalChannels.codexImages, { ...request, clientId: "claude-1" })).resolves.toEqual({ images: {} });
      // The message asked about must be one of those shown.
      await expect(invoke(terminalChannels.codexImages, { ...request, index: 1 })).resolves.toEqual({ images: {} });
    });

    it("tracks whether a plain terminal has a program in the foreground", async () => {
      const pty = new FakePty();
      registerTerminalIpc({ loadNodePty: async () => fakeNodePty(pty) as never });
      const created = await invoke<{ id: string }>(terminalChannels.create, { clientId: "manual-1", cols: 80, cwd: "/repo", rows: 24 });

      pty.onDataHandler?.("prompt % ");
      expect(lastDataEvent()).toMatchObject({ shellBusy: false });

      pty.process = "sleep";
      emit(terminalChannels.write, { id: created.id, data: "sleep 5\r" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(lastDataEvent()).toMatchObject({ data: "", shellBusy: true });

      pty.process = "zsh";
      pty.onDataHandler?.("done\nprompt % ");
      expect(lastDataEvent()).toMatchObject({ shellBusy: false });
    });

    it.each([
      ["an installed script", "node", "node /opt/homebrew/bin/pnpm dev", "pnpm dev"],
      ["a program by its path", "tail", "/usr/bin/tail -f staging.log", "tail -f staging.log"],
      ["a script you named", "node", "node serve.js", "node serve.js"],
    ])("names a plain terminal after %s while it holds the foreground", async (_what, program, args, title) => {
      const pty = new FakePty();
      registerTerminalIpc({
        foregroundCommandDelayMs: 20,
        inspectForegroundCommand: async () => args,
        loadNodePty: async () => fakeNodePty(pty) as never,
      });
      const created = await invoke<{ id: string }>(terminalChannels.create, { clientId: "manual-1", cols: 80, cwd: "/repo", rows: 24 });

      pty.process = program;
      emit(terminalChannels.write, { id: created.id, data: "\x1b[A\r" });
      await vi.waitFor(() => expect(lastDataEvent()).toMatchObject({ data: "", foregroundCommand: title }));
      expect((await invoke<TerminalListResult>(terminalChannels.list)).sessions[0]).toMatchObject({ foregroundCommand: title });

      pty.process = "zsh";
      pty.onDataHandler?.("^C\nprompt % ");
      expect(lastDataEvent()).toMatchObject({ shellBusy: false });
      expect((await invoke<TerminalListResult>(terminalChannels.list)).sessions[0]).not.toHaveProperty("foregroundCommand");
    });

    it("does not name a plain terminal after a program that ends at once, or after an agent", async () => {
      const pty = new FakePty();
      let command = "ls";
      registerTerminalIpc({
        foregroundCommandDelayMs: 40,
        inspectForegroundCommand: async () => command,
        loadNodePty: async () => fakeNodePty(pty) as never,
      });
      const created = await invoke<{ id: string }>(terminalChannels.create, { clientId: "manual-1", cols: 80, cwd: "/repo", rows: 24 });
      const named = () => sentEvents.some((event) => (event.payload as { foregroundCommand?: string }).foregroundCommand);

      pty.process = "ls";
      pty.onDataHandler?.("README.md\n");
      pty.process = "zsh";
      pty.onDataHandler?.("prompt % ");
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(named()).toBe(false);

      command = "node /opt/homebrew/bin/codex";
      pty.process = "node";
      emit(terminalChannels.write, { id: created.id, data: "\x1b[A\r" });
      pty.onDataHandler?.("Starting\n");
      await vi.waitFor(async () => {
        expect((await invoke<TerminalListResult>(terminalChannels.list)).sessions[0]).toMatchObject({ foregroundAgentKind: "codex" });
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(named()).toBe(false);
    });
  });
});
