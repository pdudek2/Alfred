import { trustedIpc } from "./trusted-ipc.js";
import {
  layoutChannels,
  type WorkspaceLayoutsSnapshot,
  type WorkspaceViewStateSetRequest,
} from "../shared/layout-ipc.js";
import { getLayoutsSnapshot, setWorkspaceViewStateSnapshot } from "./layout-store.js";

export function registerLayoutIpc(): void {
  trustedIpc.handle(layoutChannels.get, (): Promise<WorkspaceLayoutsSnapshot> => getLayoutsSnapshot());
  trustedIpc.handle(
    layoutChannels.setWorkspaceViewState,
    (_event, request: WorkspaceViewStateSetRequest): Promise<WorkspaceLayoutsSnapshot> =>
      setWorkspaceViewStateSnapshot(request),
  );
}
