import {
  createPersistedDesktopStateStore,
  normalizeDesktopState,
  type PersistedDesktopStateStore,
  type PersistedDesktopStateStoreOptions,
} from "./persisted-desktop-state.js";
import type { WorkspaceStateSetRequest, WorkspaceStateSnapshot } from "../shared/workspace-ipc.js";

export type WorkspaceStore = {
  getWorkspaceState(): Promise<WorkspaceStateSnapshot>;
  setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot>;
};

export type WorkspaceStoreOptions = PersistedDesktopStateStoreOptions & {
  persistedStateStore?: PersistedDesktopStateStore;
};

export function createWorkspaceStore(options: WorkspaceStoreOptions = {}): WorkspaceStore {
  const persistedStateStore = options.persistedStateStore ?? createPersistedDesktopStateStore(options);

  return {
    async getWorkspaceState(): Promise<WorkspaceStateSnapshot> {
      return toWorkspaceState(await persistedStateStore.getState());
    },

    async setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot> {
      const current = await persistedStateStore.getState();
      const workspaceState = toWorkspaceState(normalizeDesktopState(request));
      const next = await persistedStateStore.setState({ ...current, ...workspaceState });
      return toWorkspaceState(next);
    },
  };
}

function toWorkspaceState(state: WorkspaceStateSnapshot): WorkspaceStateSnapshot {
  return {
    workspaces: state.workspaces.map((workspace) => ({ ...workspace })),
    activeWorkspaceId: state.activeWorkspaceId,
  };
}
