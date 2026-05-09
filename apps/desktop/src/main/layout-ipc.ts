import { ipcMain } from "electron";
import {
  layoutChannels,
  type WorkspaceLayoutSetRequest,
  type WorkspaceLayoutsSnapshot,
  type WorkspaceViewStateSetRequest,
} from "../shared/layout-ipc.js";
import { getLayoutsSnapshot, setWorkspaceLayoutSnapshot, setWorkspaceViewStateSnapshot } from "./layout-store.js";

export function registerLayoutIpc(): void {
  ipcMain.handle(layoutChannels.get, (): Promise<WorkspaceLayoutsSnapshot> => getLayoutsSnapshot());
  ipcMain.handle(
    layoutChannels.setWorkspace,
    (_event, request: WorkspaceLayoutSetRequest): Promise<WorkspaceLayoutsSnapshot> => setWorkspaceLayoutSnapshot(request),
  );
  ipcMain.handle(
    layoutChannels.setWorkspaceViewState,
    (_event, request: WorkspaceViewStateSetRequest): Promise<WorkspaceLayoutsSnapshot> =>
      setWorkspaceViewStateSnapshot(request),
  );
}
