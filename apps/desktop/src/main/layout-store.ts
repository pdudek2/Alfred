import type {
  TileLayout,
  WorkspaceLayoutSetRequest,
  WorkspaceLayoutsSnapshot,
} from "../shared/layout-ipc.js";

const layoutsByWorkspace = new Map<string, Record<string, TileLayout>>();

export function getLayoutsSnapshot(): WorkspaceLayoutsSnapshot {
  return {
    layoutsByWorkspace: Object.fromEntries(
      [...layoutsByWorkspace.entries()].map(([workspaceId, layouts]) => [workspaceId, cloneLayouts(layouts)]),
    ),
  };
}

export function setWorkspaceLayoutSnapshot(request: WorkspaceLayoutSetRequest): WorkspaceLayoutsSnapshot {
  layoutsByWorkspace.set(request.workspaceId, cloneLayouts(request.layouts));
  return getLayoutsSnapshot();
}

export function clearLayoutSnapshots(): void {
  layoutsByWorkspace.clear();
}

function cloneLayouts(layouts: Record<string, TileLayout>): Record<string, TileLayout> {
  return Object.fromEntries(
    Object.entries(layouts).map(([tileId, layout]) => [tileId, { ...layout }]),
  );
}
