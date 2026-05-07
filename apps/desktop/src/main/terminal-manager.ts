import { BrowserWindow, app, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  terminalChannels,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  type TerminalExitEvent,
  type TerminalKillRequest,
  type TerminalListResult,
  type TerminalResizeRequest,
  type TerminalSessionSnapshot,
  type TerminalSessionId,
  type TerminalSessionSource,
  type TerminalWriteRequest,
} from "../shared/terminal-ipc.js";

type PtyProcess = import("node-pty").IPty;
type NodePtyModule = typeof import("node-pty");

type TerminalSession = {
  id: TerminalSessionId;
  clientId?: string;
  title: string;
  source: TerminalSessionSource;
  agentKind?: TerminalCreateResult["agentKind"];
  cwd: string;
  shell: string;
  command?: string;
  args?: string[];
  buffer: string;
  pty: PtyProcess;
  // PTY lifetime is app-scoped; BrowserWindows may close and reattach later.
  window?: BrowserWindow;
};

const sessions = new Map<TerminalSessionId, TerminalSession>();
const require = createRequire(import.meta.url);
const NODE_PTY_HELPER_MODE = 0o755;
const MAX_BUFFER_LENGTH = 200_000;

export function registerTerminalIpc(): void {
  ipcMain.handle(terminalChannels.list, (event): TerminalListResult => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (window) {
      for (const session of sessions.values()) {
        attachSessionWindow(session, window);
      }
    }

    return {
      sessions: [...sessions.values()].map(toSnapshot),
    };
  });

  ipcMain.handle(
    terminalChannels.create,
    async (event, request: TerminalCreateRequest): Promise<TerminalCreateResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        throw new Error("Terminal session requires an owning window.");
      }

      const nodePty = await loadNodePty();
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
      const session: TerminalSession = { ...metadata, buffer: "", pty, window };

      sessions.set(id, session);

      pty.onData((data) => {
        appendToBuffer(session, data);
        sendToSessionWindow(session, terminalChannels.data, { id, data });
      });

      pty.onExit(({ exitCode, signal }) => {
        disposeSession(id);
        const payload: TerminalExitEvent = signal === undefined ? { id, exitCode } : { id, exitCode, signal };
        sendToSessionWindow(session, terminalChannels.exit, payload);
      });

      return toCreateResult(session);
    },
  );

  ipcMain.on(terminalChannels.write, (_event, request: TerminalWriteRequest) => {
    sessions.get(request.id)?.pty.write(request.data);
  });

  ipcMain.on(terminalChannels.resize, (_event, request: TerminalResizeRequest) => {
    sessions
      .get(request.id)
      ?.pty.resize(normalizeDimension(request.cols, 80), normalizeDimension(request.rows, 24));
  });

  ipcMain.on(terminalChannels.kill, (_event, request: TerminalKillRequest) => {
    killSession(request.id);
  });
}

export function killAllTerminalSessions(): void {
  for (const id of sessions.keys()) {
    killSession(id);
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
  };
}

function appendToBuffer(session: TerminalSession, data: string): void {
  session.buffer += data;

  if (session.buffer.length > MAX_BUFFER_LENGTH) {
    session.buffer = session.buffer.slice(-MAX_BUFFER_LENGTH);
  }
}

function attachSessionWindow(session: TerminalSession, window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    session.window = window;
  }
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

function killSession(id: TerminalSessionId): void {
  const session = sessions.get(id);

  if (!session) {
    return;
  }

  sessions.delete(id);
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
