import { app, ipcMain } from "electron";
import os from "node:os";
import path from "node:path";
import { createCodexSessionsReader } from "./codex-sessions.js";
import { sessionsChannels, type ResolveExternalSessionResult, type TranscriptPage } from "../shared/sessions-ipc.js";

type SessionsReader = ReturnType<typeof createCodexSessionsReader>;
type RegisterSessionsOptions = {
  codexHome?: string;
  reader?: SessionsReader;
  isExternalSessionIndexingEnabled?: () => Promise<boolean> | boolean;
};

export function registerSessionsIpc(options: RegisterSessionsOptions = {}): void {
  const reader = options.reader ?? createCodexSessionsReader({ codexHome: options.codexHome ?? defaultCodexHome() });
  const isEnabled = async () => options.isExternalSessionIndexingEnabled?.() ?? true;
  let cacheGeneration = 0;
  let mutationQueue = Promise.resolve();

  const queueMutation = <T>(mutation: () => Promise<T> | T): Promise<T> => {
    const operation = mutationQueue.then(mutation, mutation);
    mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const invalidateCaches = (): Promise<void> => {
    cacheGeneration += 1;
    return queueMutation(() => reader.clearCaches());
  };

  ipcMain.handle(sessionsChannels.listExternal, async (_event, request) => {
    if (!(await isEnabled())) { await invalidateCaches(); return { sessions: [], nextCursor: null, total: 0 }; }
    const requestGeneration = cacheGeneration;
    const result = await queueMutation(() => reader.listExternalSessions(request));
    if (requestGeneration !== cacheGeneration) return { sessions: [], nextCursor: null, total: 0 };
    if (!(await isEnabled())) { await invalidateCaches(); return { sessions: [], nextCursor: null, total: 0 }; }
    return result;
  });
  ipcMain.handle(sessionsChannels.resolveExternal, async (_event, request): Promise<ResolveExternalSessionResult> => {
    if (!(await isEnabled())) { await invalidateCaches(); return { kind: "none" }; }
    return reader.resolveExternalSession(request);
  });
  ipcMain.handle(sessionsChannels.readTranscriptPage, async (_event, request): Promise<TranscriptPage> => {
    if (!isTranscriptPageRequest(request)) throw new Error("Invalid transcript page request.");
    if (!(await isEnabled())) { await invalidateCaches(); return emptyTranscriptPage(request.sessionKey); }
    const requestGeneration = cacheGeneration;
    const result = await queueMutation(() => reader.readTranscriptPage(request));
    if (requestGeneration !== cacheGeneration) return emptyTranscriptPage(request.sessionKey);
    if (!(await isEnabled())) { await invalidateCaches(); return emptyTranscriptPage(request.sessionKey); }
    return result;
  });
  ipcMain.handle(sessionsChannels.getDiagnostics, async () => {
    if (!(await isEnabled())) await invalidateCaches();
    return queueMutation(() => reader.getDiagnostics());
  });
  ipcMain.handle(sessionsChannels.clearCaches, () => {
    return invalidateCaches();
  });
}

function isTranscriptPageRequest(value: unknown): value is { sessionKey: string; cursor?: string } {
  return typeof value === "object" && value !== null
    && typeof (value as { sessionKey?: unknown }).sessionKey === "string"
    && (value as { sessionKey: string }).sessionKey.length > 0
    && ((value as { cursor?: unknown }).cursor === undefined || typeof (value as { cursor?: unknown }).cursor === "string");
}

function emptyTranscriptPage(sessionKey: string): TranscriptPage {
  return { sessionKey, blocks: [], nextCursor: null, revision: "", partial: false };
}

function defaultCodexHome(): string { return process.env.CODEX_HOME ?? path.join(app?.getPath?.("home") ?? os.homedir(), ".codex"); }
