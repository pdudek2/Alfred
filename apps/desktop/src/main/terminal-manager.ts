import { BrowserWindow, app, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  terminalChannels,
  type TerminalCreateRequest,
  type TerminalCreateResult,
  type TerminalExitEvent,
  type TerminalKillRequest,
  type TerminalResizeRequest,
  type TerminalSessionId,
  type TerminalWriteRequest,
} from "../shared/terminal-ipc.js";

type PtyProcess = import("node-pty").IPty;
type NodePtyModule = typeof import("node-pty");

type TerminalSession = {
  id: TerminalSessionId;
  onWindowClosed: () => void;
  pty: PtyProcess;
  window: BrowserWindow;
};

const sessions = new Map<TerminalSessionId, TerminalSession>();

export function registerTerminalIpc(): void {
  ipcMain.handle(
    terminalChannels.create,
    async (event, request: TerminalCreateRequest): Promise<TerminalCreateResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        throw new Error("Terminal session requires an owning window.");
      }

      const nodePty = await loadNodePty();
      const cwd = resolveTerminalCwd(request.cwd);
      const shell = resolveShell();
      const id = randomUUID();
      const onWindowClosed = () => {
        killSession(id);
      };
      const pty = nodePty.spawn(shell.command, shell.args, {
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

      sessions.set(id, { id, onWindowClosed, pty, window });

      pty.onData((data) => {
        if (!window.isDestroyed()) {
          window.webContents.send(terminalChannels.data, { id, data });
        }
      });

      pty.onExit(({ exitCode, signal }) => {
        disposeSession(id);

        if (!window.isDestroyed()) {
          const payload: TerminalExitEvent = signal === undefined ? { id, exitCode } : { id, exitCode, signal };
          window.webContents.send(terminalChannels.exit, payload);
        }
      });

      window.once("closed", onWindowClosed);

      return { id, cwd, shell: shell.command };
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

function killSession(id: TerminalSessionId): void {
  const session = sessions.get(id);

  if (!session) {
    return;
  }

  sessions.delete(id);
  if (!session.window.isDestroyed()) {
    session.window.off("closed", session.onWindowClosed);
  }
  session.pty.kill();
}

function disposeSession(id: TerminalSessionId): void {
  const session = sessions.get(id);

  if (!session) {
    return;
  }

  sessions.delete(id);
  if (!session.window.isDestroyed()) {
    session.window.off("closed", session.onWindowClosed);
  }
}

async function loadNodePty(): Promise<NodePtyModule> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "node_modules/node-pty/lib/index.js")).href;
  return import(moduleUrl) as Promise<NodePtyModule>;
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
