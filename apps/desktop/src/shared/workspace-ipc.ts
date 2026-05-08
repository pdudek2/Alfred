export type WorkspaceSnapshot = {
  id: string;
  label: string;
  shortLabel: string;
};

export type WorkspaceStateSnapshot = {
  workspaces: WorkspaceSnapshot[];
  activeWorkspaceId: string;
};

export type WorkspaceStateSetRequest = WorkspaceStateSnapshot;

export type WorkspaceApi = {
  getWorkspaceState(): Promise<WorkspaceStateSnapshot>;
  setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot>;
};

export const workspaceChannels = {
  get: "alfred:workspace:get",
  set: "alfred:workspace:set",
} as const;
