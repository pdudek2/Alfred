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
import { projectWorktreeRoots } from "./git-worktree.js";
import { scratchWorkspacePath } from "./codex-scratch.js";

type WorkspaceIpcOptions = {
  managedWorktreeRootPath?: string;
  scratchRootPath?: string;
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
  const worktreeRootSets = state.workspaces.flatMap((workspace) => {
    if (!workspace.rootPath) return [];
    return [projectWorktreeRoots(workspace.rootPath, options.managedWorktreeRootPath)];
  });
  const legacyProjectRoots = worktreeRootSets.flatMap((roots) => roots.slice(-1));
  const managedProjectRoots = worktreeRootSets.flatMap((roots) => roots.slice(0, -1));
  const baseRoots = [...workspaceRoots, ...legacyProjectRoots, ...managedProjectRoots];
  const scratchRoot = options.scratchRootPath?.trim();
  const scratchWorkspaceRoots = scratchRoot
    ? [
        scratchWorkspacePath(scratchRoot),
        ...state.workspaces.map((workspace) => scratchWorkspacePath(scratchRoot, workspace.id)),
      ]
    : [];
  const withScratchRoot = (roots: string[]) => [...roots, ...scratchWorkspaceRoots];
  return withScratchRoot(baseRoots);
}
