import type {
  TileLayout,
  WorkspaceLayoutSetRequest,
  WorkspaceLayoutsSnapshot,
  WorkspaceViewState,
  WorkspaceViewStateSetRequest,
} from "../shared/layout-ipc.js";
import type { PersistedDesktopStateStore } from "./persisted-desktop-state.js";

const layoutsByWorkspace = new Map<string, Record<string, TileLayout>>();
const viewStateByWorkspace = new Map<string, WorkspaceViewState>();
let persistedStateStore: PersistedDesktopStateStore | null = null;

export function configureLayoutPersistence(store: PersistedDesktopStateStore): void {
  persistedStateStore = store;
  layoutsByWorkspace.clear();
  viewStateByWorkspace.clear();
}

export async function getLayoutsSnapshot(): Promise<WorkspaceLayoutsSnapshot> {
  if (persistedStateStore) {
    const state = await persistedStateStore.getState();
    return {
      layoutsByWorkspace: cloneLayoutsByWorkspace(state.layoutsByWorkspace),
      viewStateByWorkspace: cloneViewStateByWorkspace(state.viewStateByWorkspace),
    };
  }

  return {
    layoutsByWorkspace: Object.fromEntries(
      [...layoutsByWorkspace.entries()].map(([workspaceId, layouts]) => [workspaceId, cloneLayouts(layouts)]),
    ),
    viewStateByWorkspace: Object.fromEntries(
      [...viewStateByWorkspace.entries()].map(([workspaceId, viewState]) => [workspaceId, { ...viewState }]),
    ),
  };
}

export async function setWorkspaceLayoutSnapshot(request: WorkspaceLayoutSetRequest): Promise<WorkspaceLayoutsSnapshot> {
  if (persistedStateStore) {
    const next = await persistedStateStore.updateState((current) => ({
      ...current,
      layoutsByWorkspace: {
        ...current.layoutsByWorkspace,
        [request.workspaceId]: cloneLayouts(request.layouts),
      },
    }));
    return {
      layoutsByWorkspace: cloneLayoutsByWorkspace(next.layoutsByWorkspace),
      viewStateByWorkspace: cloneViewStateByWorkspace(next.viewStateByWorkspace),
    };
  }

  layoutsByWorkspace.set(request.workspaceId, cloneLayouts(request.layouts));
  return getLayoutsSnapshot();
}

export async function setWorkspaceViewStateSnapshot(
  request: WorkspaceViewStateSetRequest,
): Promise<WorkspaceLayoutsSnapshot> {
  if (persistedStateStore) {
    const next = await persistedStateStore.updateState((current) => ({
      ...current,
      viewStateByWorkspace: {
        ...current.viewStateByWorkspace,
        [request.workspaceId]: cloneViewState(request.viewState),
      },
    }));
    return {
      layoutsByWorkspace: cloneLayoutsByWorkspace(next.layoutsByWorkspace),
      viewStateByWorkspace: cloneViewStateByWorkspace(next.viewStateByWorkspace),
    };
  }

  viewStateByWorkspace.set(request.workspaceId, cloneViewState(request.viewState));
  return getLayoutsSnapshot();
}

export async function clearLayoutSnapshots(): Promise<void> {
  if (persistedStateStore) {
    await persistedStateStore.updateState((current) => ({
      ...current,
      layoutsByWorkspace: {},
      viewStateByWorkspace: {},
    }));
    return;
  }

  layoutsByWorkspace.clear();
  viewStateByWorkspace.clear();
}

export function resetLayoutPersistence(): void {
  persistedStateStore = null;
  layoutsByWorkspace.clear();
  viewStateByWorkspace.clear();
}

function cloneLayoutsByWorkspace(
  layouts: Record<string, Record<string, TileLayout>>,
): Record<string, Record<string, TileLayout>> {
  return Object.fromEntries(
    Object.entries(layouts).map(([workspaceId, workspaceLayouts]) => [workspaceId, cloneLayouts(workspaceLayouts)]),
  );
}

function cloneLayouts(layouts: Record<string, TileLayout>): Record<string, TileLayout> {
  return Object.fromEntries(
    Object.entries(layouts).map(([tileId, layout]) => [tileId, { ...layout }]),
  );
}

function cloneViewStateByWorkspace(
  viewState: Record<string, WorkspaceViewState>,
): Record<string, WorkspaceViewState> {
  return Object.fromEntries(
    Object.entries(viewState).map(([workspaceId, workspaceViewState]) => [workspaceId, cloneViewState(workspaceViewState)]),
  );
}

function cloneViewState(viewState: WorkspaceViewState): WorkspaceViewState {
  return { ...viewState };
}
