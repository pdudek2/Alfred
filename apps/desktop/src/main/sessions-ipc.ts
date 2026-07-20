import { app, ipcMain } from "electron";
import os from "node:os";
import path from "node:path";
import { createCodexSessionsReader } from "./codex-sessions.js";
import { sessionsChannels, type ResolveExternalSessionResult } from "../shared/sessions-ipc.js";

type SessionsReader = ReturnType<typeof createCodexSessionsReader>;
type RegisterSessionsOptions = {
  codexHome?: string;
  reader?: SessionsReader;
  isExternalSessionIndexingEnabled?: () => Promise<boolean> | boolean;
};

export function registerSessionsIpc(options: RegisterSessionsOptions = {}): void {
  const reader = options.reader ?? createCodexSessionsReader({ codexHome: options.codexHome ?? defaultCodexHome() });
  const isEnabled = async () => options.isExternalSessionIndexingEnabled?.() ?? true;
  ipcMain.handle(sessionsChannels.listExternal, async (_event, request) => {
    if (!(await isEnabled())) { reader.clear(); return { sessions: [], nextCursor: null, total: 0 }; }
    const result = await reader.listExternalSessions(request);
    if (!(await isEnabled())) { reader.clear(); return { sessions: [], nextCursor: null, total: 0 }; }
    return result;
  });
  ipcMain.handle(sessionsChannels.resolveExternal, async (_event, request): Promise<ResolveExternalSessionResult> => {
    if (!(await isEnabled())) { reader.clear(); return { kind: "none" }; }
    return reader.resolveExternalSession(request);
  });
  ipcMain.handle(sessionsChannels.clearCaches, () => {
    reader.clear();
  });
}

function defaultCodexHome(): string { return process.env.CODEX_HOME ?? path.join(app?.getPath?.("home") ?? os.homedir(), ".codex"); }
