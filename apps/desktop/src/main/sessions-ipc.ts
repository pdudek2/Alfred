import { app, ipcMain } from "electron";
import os from "node:os";
import path from "node:path";
import { createCodexSessionsReader } from "./codex-sessions.js";
import { isAllowedWorkspacePath } from "./workspace-path.js";
import { sessionsChannels, type ResolveExternalSessionResult, type TranscriptPage } from "../shared/sessions-ipc.js";
import type { SessionsProjectInput } from "../shared/sessions-ipc.js";
import type { WorkspaceStore } from "./workspace-store.js";

type SessionsReader = ReturnType<typeof createCodexSessionsReader>;
type RegisterSessionsOptions = {
  codexHome?: string;
  reader?: SessionsReader;
  isExternalSessionIndexingEnabled?: () => Promise<boolean> | boolean;
  workspaceStore?: WorkspaceStore;
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
  const authoritativeProjects = async (request: unknown): Promise<SessionsProjectInput[]> => {
    if (!options.workspaceStore) return sanitizeProjectsFromRequest(request);
    const state = await options.workspaceStore.getWorkspaceState();
    return state.workspaces
      .map((workspace) => ({
        id: workspace.id,
        label: workspace.label,
        ...(workspace.rootPath === undefined ? {} : { rootPath: workspace.rootPath }),
      }));
  };

  ipcMain.handle(sessionsChannels.listExternal, async (_event, request) => {
    if (!(await isEnabled())) { await invalidateCaches(); return { sessions: [], nextCursor: null, total: 0 }; }
    const projects = await authoritativeProjects(request);
    const sanitizedRequest = sanitizeListRequest(request, projects);
    const requestGeneration = cacheGeneration;
    const result = await queueMutation(() => reader.listExternalSessions(sanitizedRequest));
    if (requestGeneration !== cacheGeneration) return { sessions: [], nextCursor: null, total: 0 };
    if (!(await isEnabled())) { await invalidateCaches(); return { sessions: [], nextCursor: null, total: 0 }; }
    return result;
  });
  ipcMain.handle(sessionsChannels.releaseListSnapshot, (_event, request) => {
    if (!isListSnapshotReleaseRequest(request)) throw new Error("Invalid external sessions snapshot release request.");
    return queueMutation(() => reader.releaseListSnapshot(request));
  });
  ipcMain.handle(sessionsChannels.resolveExternal, async (_event, request): Promise<ResolveExternalSessionResult> => {
    if (!(await isEnabled())) { await invalidateCaches(); return { kind: "none" }; }
    const result = await reader.resolveExternalSession(request);
    if (result.kind !== "resume" || !options.workspaceStore) return result;
    const state = await options.workspaceStore.getWorkspaceState();
    const workspace = state.workspaces.find((candidate) => candidate.id === result.projectId);
    return await pathMatchesWorkspace(result.cwd, workspace?.rootPath) ? result : { kind: "add-project" };
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

function isListSnapshotReleaseRequest(value: unknown): value is { cursor: string } {
  return typeof value === "object" && value !== null
    && typeof (value as { cursor?: unknown }).cursor === "string"
    && (value as { cursor: string }).cursor.length > 0;
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

function sanitizeListRequest(
  request: unknown,
  projects: SessionsProjectInput[],
): { projects: SessionsProjectInput[]; query?: string; cursor?: string; limit?: number } {
  const value = typeof request === "object" && request !== null ? request as {
    query?: unknown;
    cursor?: unknown;
    limit?: unknown;
  } : {};
  return {
    projects,
    ...(typeof value.query === "string" ? { query: value.query } : {}),
    ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    ...(typeof value.limit === "number" ? { limit: value.limit } : {}),
  };
}

function sanitizeProjectsFromRequest(request: unknown): SessionsProjectInput[] {
  if (typeof request !== "object" || request === null || !Array.isArray((request as { projects?: unknown }).projects)) return [];
  return (request as { projects: unknown[] }).projects.flatMap((project) => {
    if (typeof project !== "object" || project === null) return [];
    const candidate = project as { id?: unknown; label?: unknown; rootPath?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") return [];
    return [{
      id: candidate.id,
      label: candidate.label,
      ...(typeof candidate.rootPath === "string" ? { rootPath: candidate.rootPath } : {}),
    }];
  });
}

async function pathMatchesWorkspace(cwd: string, rootPath: string | undefined): Promise<boolean> {
  const root = rootPath?.replace(/\/+$/, "");
  if (!cwd || !root) return false;
  const legacyRoot = `${path.dirname(root)}/.alfred-worktrees/${path.basename(root)}`;
  return isAllowedWorkspacePath(cwd, [root, legacyRoot]);
}
