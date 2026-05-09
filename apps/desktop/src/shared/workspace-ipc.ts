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

export type WorkspaceOpenExternalTerminalRequest = {
  cwd: string;
};

export type WorkspaceOpenExternalTerminalResult =
  | { ok: true; resolvedPath: string; terminal: string }
  | { ok: false; error: string; resolvedPath?: string; terminal?: string };

export type WorkspaceOpenExternalUrlRequest = {
  url: string;
};

export type WorkspaceOpenExternalUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string; url?: string };

export type WorkspaceApi = {
  createWorkspaceFromFolder(): Promise<WorkspaceStateSnapshot>;
  getWorkspaceState(): Promise<WorkspaceStateSnapshot>;
  openExternalUrl(request: WorkspaceOpenExternalUrlRequest): Promise<WorkspaceOpenExternalUrlResult>;
  openExternalTerminal(request: WorkspaceOpenExternalTerminalRequest): Promise<WorkspaceOpenExternalTerminalResult>;
  revealPath(request: WorkspaceRevealPathRequest): Promise<WorkspaceRevealPathResult>;
  setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot>;
};

export const workspaceChannels = {
  createFromFolder: "alfred:workspace:create-from-folder",
  get: "alfred:workspace:get",
  openExternalUrl: "alfred:workspace:open-external-url",
  openExternalTerminal: "alfred:workspace:open-external-terminal",
  revealPath: "alfred:workspace:reveal-path",
  set: "alfred:workspace:set",
} as const;
