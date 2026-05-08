import { ipcMain } from "electron";
import {
  workspaceChannels,
  type WorkspaceStateSetRequest,
  type WorkspaceStateSnapshot,
} from "../shared/workspace-ipc.js";
import type { WorkspaceStore } from "./workspace-store.js";

export function registerWorkspaceIpc(store: WorkspaceStore): void {
  ipcMain.handle(workspaceChannels.get, (): Promise<WorkspaceStateSnapshot> => store.getWorkspaceState());
  ipcMain.handle(
    workspaceChannels.set,
    (_event, request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot> => store.setWorkspaceState(request),
  );
}
