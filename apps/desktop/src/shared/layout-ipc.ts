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
};

export const layoutChannels = {
  get: "alfred:layout:get",
  setWorkspaceViewState: "alfred:layout:set-workspace-view-state",
} as const;
