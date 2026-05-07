export type TileLayout = {
  tileId: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
};

export type WorkspaceLayoutsSnapshot = {
  layoutsByWorkspace: Record<string, Record<string, TileLayout>>;
};

export type WorkspaceLayoutRequest = {
  workspaceId: string;
};

export type WorkspaceLayoutSetRequest = WorkspaceLayoutRequest & {
  layouts: Record<string, TileLayout>;
};

export type LayoutApi = {
  getLayouts(): Promise<WorkspaceLayoutsSnapshot>;
  setWorkspaceLayout(request: WorkspaceLayoutSetRequest): Promise<WorkspaceLayoutsSnapshot>;
};

export const layoutChannels = {
  get: "alfred:layout:get",
  setWorkspace: "alfred:layout:set-workspace",
} as const;
