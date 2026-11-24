/** The v5 boards draw the rail at this width; it only widens from here. */
export const DEFAULT_RAIL_WIDTH = 264;
/** Still leaves the terminal and Details their minimum widths at the smallest window. */
export const MAX_RAIL_WIDTH = 392;

/** Board A draws the page panel at this width; the user drags it between the limits below. */
export const DEFAULT_PAGE_WIDTH = 600;
export const MIN_PAGE_WIDTH = 360;
/** The grid still narrows the panel first, so the terminal keeps 420px in any window. */
export const MAX_PAGE_WIDTH = 1400;

/** The shell drawer under the deck, its tab row included; the deck keeps its own minimum when it is dragged up. */
export const DEFAULT_DRAWER_HEIGHT = 250;
export const MIN_DRAWER_HEIGHT = 120;
export const MAX_DRAWER_HEIGHT = 1200;

export function clampDrawerHeight(height: unknown): number {
  return clampWidth(height, MIN_DRAWER_HEIGHT, MAX_DRAWER_HEIGHT, DEFAULT_DRAWER_HEIGHT);
}

export function clampRailWidth(width: unknown): number {
  return clampWidth(width, DEFAULT_RAIL_WIDTH, MAX_RAIL_WIDTH, DEFAULT_RAIL_WIDTH);
}

export function clampPageWidth(width: unknown): number {
  return clampWidth(width, MIN_PAGE_WIDTH, MAX_PAGE_WIDTH, DEFAULT_PAGE_WIDTH);
}

function clampWidth(width: unknown, min: number, max: number, fallback: number): number {
  if (typeof width !== "number" || !Number.isFinite(width)) return fallback;
  return Math.min(max, Math.max(min, Math.round(width)));
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
  pageWidth?: number;
  drawerHeight?: number;
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
  setPageWidth(width: number): Promise<void>;
  setDrawerHeight(height: number): Promise<void>;
};

export const layoutChannels = {
  get: "alfred:layout:get",
  setWorkspaceViewState: "alfred:layout:set-workspace-view-state",
  setRailWidth: "alfred:layout:set-rail-width",
  setPageWidth: "alfred:layout:set-page-width",
  setDrawerHeight: "alfred:layout:set-drawer-height",
} as const;
