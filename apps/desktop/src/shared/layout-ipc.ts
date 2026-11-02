/** The v5 boards draw the rail at this width; it only widens from here. */
export const DEFAULT_RAIL_WIDTH = 264;
/** Still leaves the terminal and Details their minimum widths at the smallest window. */
export const MAX_RAIL_WIDTH = 392;

export function clampRailWidth(width: unknown): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return DEFAULT_RAIL_WIDTH;
  return Math.min(MAX_RAIL_WIDTH, Math.max(DEFAULT_RAIL_WIDTH, Math.round(width)));
}

export type DispatchTargetSnapshot = {
  kind: "session" | "workspace";
  id: string;
  label: string;
};

export type WorkspaceViewState = {
  dispatchTarget?: DispatchTargetSnapshot;
  previewDockOpen?: boolean;
  selectedSessionId?: string;
};

export type WorkspaceLayoutsSnapshot = {
  viewStateByWorkspace: Record<string, WorkspaceViewState>;
  railWidth?: number;
};

export type WorkspaceLayoutRequest = {
  workspaceId: string;
};

export type WorkspaceViewStateSetRequest = WorkspaceLayoutRequest & {
  viewState: WorkspaceViewState;
};

export type LayoutApi = {
  getLayouts(): Promise<WorkspaceLayoutsSnapshot>;
  setWorkspaceViewState(request: WorkspaceViewStateSetRequest): Promise<WorkspaceLayoutsSnapshot>;
  setRailWidth(width: number): Promise<void>;
};

export const layoutChannels = {
  get: "alfred:layout:get",
  setWorkspaceViewState: "alfred:layout:set-workspace-view-state",
  setRailWidth: "alfred:layout:set-rail-width",
} as const;
