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
      return persistedStateStore.getState();
    },

    async setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot> {
      return persistedStateStore.setState(normalizeDesktopState(request));
    },
  };
}
