import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import {
  workspaceChannels,
  type WorkspaceStateSetRequest,
  type WorkspaceStateSnapshot,
} from "../shared/workspace-ipc.js";
import { openExternalUrl } from "./external-url.js";
import { openExternalTerminal } from "./external-terminal.js";
import type { WorkspaceStore } from "./workspace-store.js";
import { resolveWorkspacePathForReveal } from "./workspace-path.js";

export function registerWorkspaceIpc(store: WorkspaceStore): void {
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
    openExternalTerminal(request, { allowedRoots: await allowedWorkspaceRoots(store) }),
  );
  ipcMain.handle(workspaceChannels.revealPath, async (_event, request) => {
    const result = await resolveWorkspacePathForReveal(request, { allowedRoots: await allowedWorkspaceRoots(store) });
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

export async function allowedWorkspaceRoots(store: WorkspaceStore): Promise<string[]> {
  const state = await store.getWorkspaceState();
  return state.workspaces.flatMap((workspace) => {
    if (!workspace.rootPath) return [];
    const rootPath = path.resolve(workspace.rootPath);
    const worktreeRoot = path.join(path.dirname(rootPath), ".alfred-worktrees", path.basename(rootPath));
    return [rootPath, worktreeRoot];
  });
}
