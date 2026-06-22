import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import {
  workspaceChannels,
  type WorkspaceBindFolderRequest,
  type WorkspaceStateSetRequest,
  type WorkspaceStateSnapshot,
} from "../shared/workspace-ipc.js";
import { openExternalUrl } from "./external-url.js";
import { openExternalTerminal } from "./external-terminal.js";
import type { WorkspaceStore } from "./workspace-store.js";
import { resolveWorkspacePathForReveal } from "./workspace-path.js";
import { managedProjectWorktreeRoot } from "./git-worktree.js";

type WorkspaceIpcOptions = {
  managedWorktreeRootPath?: string;
};

export function registerWorkspaceIpc(store: WorkspaceStore, options: WorkspaceIpcOptions = {}): void {
  ipcMain.handle(
    workspaceChannels.bindFolder,
    async (event, request: WorkspaceBindFolderRequest): Promise<WorkspaceStateSnapshot> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showOpenDialog(window, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] });

      if (result.canceled || result.filePaths.length === 0) {
        return store.getWorkspaceState();
      }

      return store.bindWorkspaceToPath({ workspaceId: request.workspaceId, rootPath: result.filePaths[0] ?? "" });
    },
  );
  ipcMain.handle(workspaceChannels.createFromFolder, async (event): Promise<WorkspaceStateSnapshot> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });

    if (result.canceled || result.filePaths.length === 0) {
      return store.getWorkspaceState();
    }

    return store.createWorkspaceFromPath(result.filePaths[0] ?? "");
  });
  ipcMain.handle(workspaceChannels.get, (): Promise<WorkspaceStateSnapshot> => store.getWorkspaceState());
  ipcMain.handle(workspaceChannels.openExternalUrl, (_event, request) => openExternalUrl(request));
  ipcMain.handle(workspaceChannels.openExternalTerminal, async (_event, request) =>
    openExternalTerminal(request, { allowedRoots: await allowedWorkspaceRoots(store, options) }),
  );
  ipcMain.handle(workspaceChannels.revealPath, async (_event, request) => {
    const result = await resolveWorkspacePathForReveal(request, { allowedRoots: await allowedWorkspaceRoots(store, options) });
    if (result.ok) {
      shell.showItemInFolder(result.resolvedPath);
    }
    return result;
  });
  ipcMain.handle(
    workspaceChannels.set,
    (_event, request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot> => store.setWorkspaceState(request),
  );
}

export async function allowedWorkspaceRoots(store: WorkspaceStore, options: WorkspaceIpcOptions = {}): Promise<string[]> {
  const state = await store.getWorkspaceState();
  const workspaceRoots = state.workspaces.flatMap((workspace) => {
    if (!workspace.rootPath) return [];
    return [path.resolve(workspace.rootPath)];
  });
  const legacyProjectRoots = state.workspaces.flatMap((workspace) => {
    if (!workspace.rootPath) return [];
    return [legacyProjectWorktreeRoot(workspace.rootPath)];
  });
  const managedRoot = options.managedWorktreeRootPath?.trim();
  if (!managedRoot) return [...workspaceRoots, ...legacyProjectRoots];

  const managedProjectRoots = state.workspaces.flatMap((workspace) => {
    if (!workspace.rootPath) return [];
    return [managedProjectWorktreeRoot(managedRoot, workspace.rootPath)];
  });
  return [...workspaceRoots, ...legacyProjectRoots, ...managedProjectRoots];
}

function legacyProjectWorktreeRoot(rootPath: string): string {
  const resolvedRootPath = path.resolve(rootPath);
  return path.join(path.dirname(resolvedRootPath), ".alfred-worktrees", path.basename(resolvedRootPath));
}
