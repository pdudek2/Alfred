import { BrowserWindow, app, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  appendActivityEvent,
  classifyTerminalOutputActivity,
  type SessionActivityEvent,
} from "../shared/session-activity.js";
import {
  terminalChannels,
  type PersistedTerminalSessionSnapshot,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  type TerminalForgetRequest,
  type TerminalExitEvent,
  type TerminalKillRequest,
  type TerminalListResult,
  type TerminalResizeRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionId,
  type TerminalSessionSource,
  type TerminalWriteRequest,
} from "../shared/terminal-ipc.js";
import type { PersistedDesktopStateStore } from "./persisted-desktop-state.js";

type PtyProcess = import("node-pty").IPty;
type NodePtyModule = typeof import("node-pty");
type TerminalIpcOptions = {
  loadNodePty?: () => Promise<NodePtyModule>;
};

type TerminalSession = {
  id: TerminalSessionId;
  clientId?: string;
  title: string;
  source: TerminalSessionSource;
  agentKind?: TerminalCreateResult["agentKind"];
  workspaceId?: string;
  cwd: string;
  shell: string;
  command?: string;
  args?: string[];
  buffer: string;
  activityEvents?: SessionActivityEvent[];
  lastActivityAt?: number;
  pty: PtyProcess;
  // PTY lifetime is app-scoped; BrowserWindows may close and reattach later.
  window?: BrowserWindow;
  ownerWindowId: number;
};

const sessions = new Map<TerminalSessionId, TerminalSession>();
const restoredSessionSnapshots = new Map<string, PersistedTerminalSessionSnapshot>();
const forgottenClientIds = new Set<string>();
const require = createRequire(import.meta.url);
const NODE_PTY_HELPER_MODE = 0o755;
const MAX_BUFFER_LENGTH = 200_000;
const MAX_PERSISTED_BUFFER_LENGTH = 120_000;
let persistedStateStore: PersistedDesktopStateStore | null = null;
let persistenceHydrated = false;
let persistDebounceMs = 250;
let persistTimer: NodeJS.Timeout | null = null;

export function configureTerminalPersistence(
  store: PersistedDesktopStateStore,
  options: { debounceMs?: number } = {},
): void {
  persistedStateStore = store;
  persistenceHydrated = false;
  restoredSessionSnapshots.clear();
  forgottenClientIds.clear();
  persistDebounceMs = options.debounceMs ?? 250;
}

export function resetTerminalPersistenceForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistedStateStore = null;
  persistenceHydrated = false;
  restoredSessionSnapshots.clear();
  forgottenClientIds.clear();
  persistDebounceMs = 250;
}

export function registerTerminalIpc(options: TerminalIpcOptions = {}): void {
  ipcMain.handle(terminalChannels.list, async (event): Promise<TerminalListResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return { sessions: [] };
    }

    await hydratePersistedTerminalSessions();
    const visibleSessions = [...sessions.values()].filter((session) => canAttachToWindow(session, window));
    const liveClientIds = new Set(
      visibleSessions.map((session) => session.clientId).filter((clientId): clientId is string => Boolean(clientId)),
    );

    for (const session of visibleSessions) {
      attachSessionWindow(session, window);
    }

    return {
      sessions: visibleSessions.map(toSnapshot),
      restoredSessions: [...restoredSessionSnapshots.values()].filter(
        (session) => !liveClientIds.has(session.clientId),
      ),
    };
  });

  ipcMain.handle(
    terminalChannels.create,
    async (event, request: TerminalCreateRequest): Promise<TerminalCreateResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        throw new Error("Terminal session requires an owning window.");
      }

      const nodePty = await (options.loadNodePty ?? loadNodePty)();
      const cwd = resolveTerminalCwd(request.cwd);
      const resolved = resolveCommand(request);
      const id = randomUUID();
      const metadata = sessionMetadata(id, request, cwd, resolved.command);
      const pty = nodePty.spawn(resolved.command, resolved.args, {
        name: "xterm-256color",
        cols: normalizeDimension(request.cols, 80),
        rows: normalizeDimension(request.rows, 24),
        cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      });
      const session: TerminalSession = { ...metadata, buffer: "", activityEvents: [], ownerWindowId: window.id, pty, window };

      sessions.set(id, session);
      if (session.clientId) {
        forgottenClientIds.delete(session.clientId);
      }
      rememberSessionSnapshot(session);

      pty.onData((data) => {
        appendToBuffer(session, data);
        recordOutputActivity(session, data);
        rememberSessionSnapshot(session);
        sendToSessionWindow(session, terminalChannels.data, { id, data });
      });

      pty.onExit(({ exitCode, signal }) => {
        recordSessionActivity(session, {
          kind: "lifecycle",
          title: "Process exited",
          detail: `The terminal process exited with code ${exitCode}.`,
        });
        rememberSessionSnapshot(session);
        disposeSession(id);
        const payload: TerminalExitEvent = signal === undefined ? { id, exitCode } : { id, exitCode, signal };
        sendToSessionWindow(session, terminalChannels.exit, payload);
      });

      return toCreateResult(session);
    },
  );

  ipcMain.on(terminalChannels.write, (event, request: TerminalWriteRequest) => {
    const session = getOwnedSession(event.sender, request.id);
    session?.pty.write(request.data);
  });

  ipcMain.on(terminalChannels.resize, (event, request: TerminalResizeRequest) => {
    const session = getOwnedSession(event.sender, request.id);
    session?.pty.resize(normalizeDimension(request.cols, 80), normalizeDimension(request.rows, 24));
  });

  ipcMain.on(terminalChannels.kill, (event, request: TerminalKillRequest) => {
    if (getOwnedSession(event.sender, request.id)) {
      killSession(request.id, { forgetSnapshot: true });
    }
  });

  ipcMain.on(terminalChannels.forget, (_event, request: TerminalForgetRequest) => {
    forgetPersistedSession(request.clientId);
  });
}

export function killAllTerminalSessions(): void {
  for (const id of sessions.keys()) {
    killSession(id, { forgetSnapshot: false });
  }
}

export function getTerminalSessionCount(): number {
  return sessions.size;
}

function sessionMetadata(
  id: TerminalSessionId,
  request: TerminalCreateRequest,
  cwd: string,
  shell: string,
): TerminalCreateResult {
  return {
    id,
    ...(request.clientId === undefined ? {} : { clientId: request.clientId }),
    title: request.title ?? defaultSessionTitle(request.source ?? "manual", shell),
    source: request.source ?? "manual",
    ...(request.agentKind === undefined ? {} : { agentKind: request.agentKind }),
    ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
    cwd,
    shell,
    ...(request.command === undefined ? {} : { command: request.command }),
    ...(request.args === undefined ? {} : { args: request.args }),
  };
}

function toCreateResult(session: TerminalSession): TerminalCreateResult {
  return {
    id: session.id,
    ...(session.clientId === undefined ? {} : { clientId: session.clientId }),
    title: session.title,
    source: session.source,
    ...(session.agentKind === undefined ? {} : { agentKind: session.agentKind }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    cwd: session.cwd,
    shell: session.shell,
    ...(session.command === undefined ? {} : { command: session.command }),
    ...(session.args === undefined ? {} : { args: session.args }),
  };
}

function toSnapshot(session: TerminalSession): TerminalSessionSnapshot {
  return {
    ...toCreateResult(session),
    buffer: session.buffer,
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
    ...(session.lastActivityAt === undefined ? {} : { lastActivityAt: session.lastActivityAt }),
  };
}

function appendToBuffer(session: TerminalSession, data: string): void {
  session.buffer += data;

  if (session.buffer.length > MAX_BUFFER_LENGTH) {
    session.buffer = session.buffer.slice(-MAX_BUFFER_LENGTH);
  }
}

async function hydratePersistedTerminalSessions(): Promise<void> {
  if (persistenceHydrated || !persistedStateStore) {
    return;
  }

  const state = await persistedStateStore.getState();
  restoredSessionSnapshots.clear();
  for (const session of state.restoredTerminalSessions) {
    restoredSessionSnapshots.set(session.clientId, clonePersistedSession(session));
  }
  persistenceHydrated = true;
}

function rememberSessionSnapshot(session: TerminalSession): void {
  const snapshot = toPersistedSnapshot(session);
  if (!snapshot) return;
  if (forgottenClientIds.has(snapshot.clientId)) return;

  restoredSessionSnapshots.set(snapshot.clientId, snapshot);
  scheduleTerminalPersistence();
}

function forgetPersistedSession(clientId: string): void {
  if (!clientId) return;
  forgottenClientIds.add(clientId);
  restoredSessionSnapshots.delete(clientId);
  scheduleTerminalPersistence();
}

function toPersistedSnapshot(session: TerminalSession): PersistedTerminalSessionSnapshot | null {
  if (!session.clientId) return null;
  return {
    clientId: session.clientId,
    title: session.title,
    source: session.source,
    ...(session.agentKind === undefined ? {} : { agentKind: session.agentKind }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    cwd: session.cwd,
    shell: session.shell,
    ...(session.command === undefined ? {} : { command: session.command }),
    ...(session.args === undefined ? {} : { args: [...session.args] }),
    buffer: tailBuffer(session.buffer, MAX_PERSISTED_BUFFER_LENGTH),
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
    ...(session.lastActivityAt === undefined ? {} : { lastActivityAt: session.lastActivityAt }),
  };
}

function scheduleTerminalPersistence(): void {
  if (!persistedStateStore) return;

  if (persistDebounceMs <= 0) {
    void persistTerminalSnapshots();
    return;
  }

  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistTerminalSnapshots();
  }, persistDebounceMs);
}

async function persistTerminalSnapshots(): Promise<void> {
  const store = persistedStateStore;
  if (!store) return;

  const current = await store.getState();
  await store.setState({
    ...current,
    restoredTerminalSessions: [...restoredSessionSnapshots.values()].map((session) => clonePersistedSession(session)),
  });
}

function clonePersistedSession(session: PersistedTerminalSessionSnapshot): PersistedTerminalSessionSnapshot {
  return {
    ...session,
    ...(session.args === undefined ? {} : { args: [...session.args] }),
    ...(session.activityEvents === undefined ? {} : { activityEvents: cloneActivityEvents(session.activityEvents) }),
  };
}

function recordOutputActivity(session: TerminalSession, data: string): void {
  const activity = classifyTerminalOutputActivity(data);
  if (!activity) return;
  recordSessionActivity(session, activity);
}

function recordSessionActivity(
  session: TerminalSession,
  activity: Parameters<typeof appendActivityEvent>[2],
): void {
  const result = appendActivityEvent(session.activityEvents, session.clientId ?? session.id, activity);
  session.activityEvents = result.events;
  session.lastActivityAt = result.lastActivityAt;
}

function cloneActivityEvents(events: SessionActivityEvent[]): SessionActivityEvent[] {
  return events.map((event) => ({ ...event }));
}

function tailBuffer(buffer: string, maxLength: number): string {
  return buffer.length > maxLength ? buffer.slice(-maxLength) : buffer;
}

function attachSessionWindow(session: TerminalSession, window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    session.window = window;
    session.ownerWindowId = window.id;
  }
}

function getOwnedSession(sender: Electron.WebContents, sessionId: TerminalSessionId): TerminalSession | undefined {
  const window = BrowserWindow.fromWebContents(sender);
  const session = sessions.get(sessionId);

  if (!window || !session || !canAttachToWindow(session, window)) {
    return undefined;
  }

  attachSessionWindow(session, window);
  return session;
}

function canAttachToWindow(session: TerminalSession, window: BrowserWindow): boolean {
  return session.ownerWindowId === window.id || !hasLiveWindow(session.ownerWindowId);
}

function hasLiveWindow(windowId: number): boolean {
  return BrowserWindow.getAllWindows().some((window) => window.id === windowId && !window.isDestroyed());
}

function sendToSessionWindow(session: TerminalSession, channel: string, payload: unknown): void {
  if (!session.window || session.window.isDestroyed()) {
    return;
  }

  session.window.webContents.send(channel, payload);
}

function defaultSessionTitle(source: TerminalSessionSource, shell: string): string {
  return source === "alfred" ? shell : "Manual terminal";
}

function killSession(id: TerminalSessionId, options: { forgetSnapshot: boolean }): void {
  const session = sessions.get(id);

  if (!session) {
    return;
  }

  sessions.delete(id);
  if (options.forgetSnapshot && session.clientId) {
    forgetPersistedSession(session.clientId);
  }
  session.pty.kill();
}

function disposeSession(id: TerminalSessionId): void {
  const session = sessions.get(id);

  if (!session) {
    return;
  }

  sessions.delete(id);
}

async function loadNodePty(): Promise<NodePtyModule> {
  const nodePtyIndexPath = require.resolve("node-pty/lib/index.js");

  await ensureNodePtySpawnHelperExecutable(nodePtyIndexPath);

  const moduleUrl = pathToFileURL(nodePtyIndexPath).href;
  return import(moduleUrl) as Promise<NodePtyModule>;
}

async function ensureNodePtySpawnHelperExecutable(nodePtyIndexPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  const helperPath = path.resolve(
    path.dirname(nodePtyIndexPath),
    `../prebuilds/darwin-${process.arch}/spawn-helper`,
  );

  try {
    await chmod(helperPath, NODE_PTY_HELPER_MODE);
  } catch (error: unknown) {
    throw new Error(
      `Unable to prepare node-pty spawn helper at ${helperPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function resolveCommand(request: TerminalCreateRequest): { command: string; args: string[] } {
  if (request.command) {
    return { command: request.command, args: request.args ?? [] };
  }
  return resolveShell();
}

function resolveShell(): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: process.env.COMSPEC ?? "powershell.exe", args: [] };
  }

  return { command: process.env.SHELL ?? "/bin/zsh", args: ["-l"] };
}

function resolveTerminalCwd(cwd: string | undefined): string {
  if (!cwd) {
    return defaultTerminalCwd();
  }

  return path.resolve(cwd);
}

function defaultTerminalCwd(): string {
  return process.env.ALFRED_DESKTOP_WORKSPACE_CWD ?? process.env.INIT_CWD ?? path.resolve(app.getAppPath(), "../..");
}

function normalizeDimension(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value < 1000 ? value : fallback;
}
