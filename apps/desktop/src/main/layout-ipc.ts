import { ipcMain } from "electron";
import {
  layoutChannels,
  type WorkspaceLayoutSetRequest,
  type WorkspaceLayoutsSnapshot,
} from "../shared/layout-ipc.js";
import { getLayoutsSnapshot, setWorkspaceLayoutSnapshot } from "./layout-store.js";

export function registerLayoutIpc(): void {
  ipcMain.handle(layoutChannels.get, (): WorkspaceLayoutsSnapshot => getLayoutsSnapshot());
  ipcMain.handle(
    layoutChannels.setWorkspace,
    (_event, request: WorkspaceLayoutSetRequest): WorkspaceLayoutsSnapshot => setWorkspaceLayoutSnapshot(request),
  );
}
