import { trustedIpc } from "./trusted-ipc.js";
import {
  layoutChannels,
  type WorkspaceLayoutSetRequest,
  type WorkspaceLayoutsSnapshot,
  type WorkspaceViewStateSetRequest,
} from "../shared/layout-ipc.js";
import { getLayoutsSnapshot, setWorkspaceLayoutSnapshot, setWorkspaceViewStateSnapshot } from "./layout-store.js";

export function registerLayoutIpc(): void {
  trustedIpc.handle(layoutChannels.get, (): Promise<WorkspaceLayoutsSnapshot> => getLayoutsSnapshot());
  trustedIpc.handle(
    layoutChannels.setWorkspace,
    (_event, request: WorkspaceLayoutSetRequest): Promise<WorkspaceLayoutsSnapshot> => setWorkspaceLayoutSnapshot(request),
  );
  trustedIpc.handle(
    layoutChannels.setWorkspaceViewState,
    (_event, request: WorkspaceViewStateSetRequest): Promise<WorkspaceLayoutsSnapshot> =>
      setWorkspaceViewStateSnapshot(request),
  );
}
