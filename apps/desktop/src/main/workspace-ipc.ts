import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  workspaceChannels,
  type WorkspaceStateSetRequest,
  type WorkspaceStateSnapshot,
} from "../shared/workspace-ipc.js";
import type { WorkspaceStore } from "./workspace-store.js";

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
  ipcMain.handle(
    workspaceChannels.set,
    (_event, request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot> => store.setWorkspaceState(request),
  );
}
