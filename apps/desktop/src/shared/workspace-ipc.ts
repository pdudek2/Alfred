export type WorkspaceSnapshot = {
  id: string;
  label: string;
  shortLabel: string;
  rootPath?: string;
  gitBranch?: string;
};

export type WorkspaceStateSnapshot = {
  workspaces: WorkspaceSnapshot[];
  activeWorkspaceId: string;
};

export type WorkspaceStateSetRequest = WorkspaceStateSnapshot;

export type WorkspaceRevealPathRequest = {
  cwd?: string;
  path: string;
};

export type WorkspaceRevealPathResult =
  | { ok: true; resolvedPath: string }
  | { ok: false; error: string; resolvedPath?: string };

export type WorkspaceApi = {
  createWorkspaceFromFolder(): Promise<WorkspaceStateSnapshot>;
  getWorkspaceState(): Promise<WorkspaceStateSnapshot>;
  revealPath(request: WorkspaceRevealPathRequest): Promise<WorkspaceRevealPathResult>;
  setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot>;
};

export const workspaceChannels = {
  createFromFolder: "alfred:workspace:create-from-folder",
  get: "alfred:workspace:get",
  revealPath: "alfred:workspace:reveal-path",
  set: "alfred:workspace:set",
} as const;
