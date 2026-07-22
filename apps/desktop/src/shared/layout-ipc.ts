export type TileLayout = {
  tileId: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

export type WorkMode = "desk" | "focus" | "split";

export const PREVIEW_DOCK_MIN_WIDTH = 420;
export const PREVIEW_DOCK_DEFAULT_WIDTH = 500;
export const PREVIEW_DOCK_MAX_WIDTH = 620;

export type DispatchTargetSnapshot = {
  kind: "session" | "workspace";
  id: string;
  label: string;
};

export type WorkspaceViewState = {
  collapsedSessionIds?: string[];
  dispatchTarget?: DispatchTargetSnapshot;
  previewDockOpen?: boolean;
  previewDockWidth?: number;
  workMode?: WorkMode;
  selectedSessionId?: string;
};

export type WorkspaceLayoutsSnapshot = {
  layoutsByWorkspace: Record<string, Record<string, TileLayout>>;
  viewStateByWorkspace: Record<string, WorkspaceViewState>;
};

export type WorkspaceLayoutRequest = {
  workspaceId: string;
};

export type WorkspaceLayoutSetRequest = WorkspaceLayoutRequest & {
  layouts: Record<string, TileLayout>;
};

export type WorkspaceViewStateSetRequest = WorkspaceLayoutRequest & {
  viewState: WorkspaceViewState;
};

export type LayoutApi = {
  getLayouts(): Promise<WorkspaceLayoutsSnapshot>;
  setWorkspaceLayout(request: WorkspaceLayoutSetRequest): Promise<WorkspaceLayoutsSnapshot>;
  setWorkspaceViewState(request: WorkspaceViewStateSetRequest): Promise<WorkspaceLayoutsSnapshot>;
};

export const layoutChannels = {
  get: "alfred:layout:get",
  setWorkspace: "alfred:layout:set-workspace",
  setWorkspaceViewState: "alfred:layout:set-workspace-view-state",
} as const;
