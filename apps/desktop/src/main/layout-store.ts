import {
  clampRailWidth,
  type WorkspaceLayoutsSnapshot,
  type WorkspaceViewState,
  type WorkspaceViewStateSetRequest,
} from "../shared/layout-ipc.js";
import type { PersistedDesktopStateStore } from "./persisted-desktop-state.js";

const viewStateByWorkspace = new Map<string, WorkspaceViewState>();
let railWidth: number | undefined;
let persistedStateStore: PersistedDesktopStateStore | null = null;

export function configureLayoutPersistence(store: PersistedDesktopStateStore): void {
  persistedStateStore = store;
  viewStateByWorkspace.clear();
  railWidth = undefined;
}

export async function getLayoutsSnapshot(): Promise<WorkspaceLayoutsSnapshot> {
  if (persistedStateStore) {
    const state = await persistedStateStore.getState();
    return {
      viewStateByWorkspace: cloneViewStateByWorkspace(state.viewStateByWorkspace),
      ...(state.railWidth === undefined ? {} : { railWidth: state.railWidth }),
    };
  }

  return {
    viewStateByWorkspace: Object.fromEntries(
      [...viewStateByWorkspace.entries()].map(([workspaceId, viewState]) => [workspaceId, { ...viewState }]),
    ),
    ...(railWidth === undefined ? {} : { railWidth }),
  };
}

export async function setRailWidthSnapshot(width: unknown): Promise<void> {
  const next = clampRailWidth(width);
  if (persistedStateStore) {
    await persistedStateStore.updateState((current) => ({ ...current, railWidth: next }));
    return;
  }
  railWidth = next;
}

export async function setWorkspaceViewStateSnapshot(
  request: WorkspaceViewStateSetRequest,
): Promise<WorkspaceLayoutsSnapshot> {
  if (persistedStateStore) {
    const next = await persistedStateStore.updateState((current) => ({
      ...current,
      viewStateByWorkspace: {
        ...current.viewStateByWorkspace,
        [request.workspaceId]: cloneViewState({
          ...current.viewStateByWorkspace[request.workspaceId],
          ...request.viewState,
        }),
      },
    }));
    return { viewStateByWorkspace: cloneViewStateByWorkspace(next.viewStateByWorkspace) };
  }

  viewStateByWorkspace.set(request.workspaceId, cloneViewState({
    ...viewStateByWorkspace.get(request.workspaceId),
    ...request.viewState,
  }));
  return getLayoutsSnapshot();
}

export async function clearLayoutSnapshots(): Promise<void> {
  if (persistedStateStore) {
    await persistedStateStore.updateState((current) => ({
      ...current,
      viewStateByWorkspace: {},
    }));
    return;
  }

  viewStateByWorkspace.clear();
}

export function resetLayoutPersistence(): void {
  persistedStateStore = null;
  viewStateByWorkspace.clear();
  railWidth = undefined;
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
