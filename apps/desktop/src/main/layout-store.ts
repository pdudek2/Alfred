import type {
  TileLayout,
  WorkspaceLayoutSetRequest,
  WorkspaceLayoutsSnapshot,
} from "../shared/layout-ipc.js";
import type { PersistedDesktopStateStore } from "./persisted-desktop-state.js";

const layoutsByWorkspace = new Map<string, Record<string, TileLayout>>();
let persistedStateStore: PersistedDesktopStateStore | null = null;

export function configureLayoutPersistence(store: PersistedDesktopStateStore): void {
  persistedStateStore = store;
  layoutsByWorkspace.clear();
}

export async function getLayoutsSnapshot(): Promise<WorkspaceLayoutsSnapshot> {
  if (persistedStateStore) {
    return {
      layoutsByWorkspace: cloneLayoutsByWorkspace((await persistedStateStore.getState()).layoutsByWorkspace),
    };
  }

  return {
    layoutsByWorkspace: Object.fromEntries(
      [...layoutsByWorkspace.entries()].map(([workspaceId, layouts]) => [workspaceId, cloneLayouts(layouts)]),
    ),
  };
}

export async function setWorkspaceLayoutSnapshot(request: WorkspaceLayoutSetRequest): Promise<WorkspaceLayoutsSnapshot> {
  if (persistedStateStore) {
    const current = await persistedStateStore.getState();
    const next = await persistedStateStore.setState({
      ...current,
      layoutsByWorkspace: {
        ...current.layoutsByWorkspace,
        [request.workspaceId]: cloneLayouts(request.layouts),
      },
    });
    return { layoutsByWorkspace: cloneLayoutsByWorkspace(next.layoutsByWorkspace) };
  }

  layoutsByWorkspace.set(request.workspaceId, cloneLayouts(request.layouts));
  return getLayoutsSnapshot();
}

export async function clearLayoutSnapshots(): Promise<void> {
  if (persistedStateStore) {
    const current = await persistedStateStore.getState();
    await persistedStateStore.setState({ ...current, layoutsByWorkspace: {} });
    return;
  }

  layoutsByWorkspace.clear();
}

export function resetLayoutPersistence(): void {
  persistedStateStore = null;
  layoutsByWorkspace.clear();
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
