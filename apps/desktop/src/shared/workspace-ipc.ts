export type WorkspaceSnapshot = {
  id: string;
  label: string;
  shortLabel: string;
  rootPath?: string;
};

export type WorkspaceStateSnapshot = {
  workspaces: WorkspaceSnapshot[];
  activeWorkspaceId: string;
};

export type WorkspaceStateSetRequest = WorkspaceStateSnapshot;

export type WorkspaceApi = {
  createWorkspaceFromFolder(): Promise<WorkspaceStateSnapshot>;
  getWorkspaceState(): Promise<WorkspaceStateSnapshot>;
  setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot>;
};

export const workspaceChannels = {
  createFromFolder: "alfred:workspace:create-from-folder",
  get: "alfred:workspace:get",
  set: "alfred:workspace:set",
} as const;
