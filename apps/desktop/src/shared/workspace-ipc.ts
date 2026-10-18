export type WorkspaceMissionBrief = {
  goal: string;
  doneWhen: string[];
  guardrails: string[];
};

export type WorkspaceRootStatus = "available" | "missing";

export type WorkspaceSnapshot = {
  id: string;
  label: string;
  shortLabel: string;
  rootPath?: string;
  rootStatus?: WorkspaceRootStatus;
  gitBranch?: string;
  missionBrief?: WorkspaceMissionBrief;
};

export type WorkspaceStateSnapshot = {
  workspaces: WorkspaceSnapshot[];
  activeWorkspaceId: string;
};

export type WorkspaceStateSetRequest = WorkspaceStateSnapshot;

export type WorkspaceBindFolderRequest = {
  workspaceId: string;
};

export type WorkspaceRevealPathRequest = {
  cwd?: string;
  path: string;
};

export type WorkspaceRevealPathResult =
  | { ok: true; resolvedPath: string }
  | { ok: false; error: string; resolvedPath?: string };

// An image a terminal links to: an absolute path, ~/…, or a path relative to the session's cwd.
export type WorkspaceImageRequest = {
  path: string;
  cwd?: string;
};

export type WorkspaceImageThumbnailResult = { ok: true; dataUrl: string } | { ok: false; error: string };

export type WorkspaceQuickLookImageResult = { ok: true } | { ok: false; error: string };

// The image types Claude Code attaches from a pasted path (its own check, as of 2.1.302).
export const ATTACHABLE_IMAGE_PATH = /\.(?:png|jpe?g|gif|webp)$/i;

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
  bindFolderToWorkspace(request: WorkspaceBindFolderRequest): Promise<WorkspaceStateSnapshot>;
  createWorkspaceFromFolder(): Promise<WorkspaceStateSnapshot>;
  getWorkspaceState(): Promise<WorkspaceStateSnapshot>;
  openExternalUrl(request: WorkspaceOpenExternalUrlRequest): Promise<WorkspaceOpenExternalUrlResult>;
  openExternalTerminal(request: WorkspaceOpenExternalTerminalRequest): Promise<WorkspaceOpenExternalTerminalResult>;
  imageThumbnail(request: WorkspaceImageRequest): Promise<WorkspaceImageThumbnailResult>;
  quickLookImage(request: WorkspaceImageRequest): Promise<WorkspaceQuickLookImageResult>;
  revealPath(request: WorkspaceRevealPathRequest): Promise<WorkspaceRevealPathResult>;
  setWorkspaceState(request: WorkspaceStateSetRequest): Promise<WorkspaceStateSnapshot>;
};

export const workspaceChannels = {
  bindFolder: "alfred:workspace:bind-folder",
  createFromFolder: "alfred:workspace:create-from-folder",
  get: "alfred:workspace:get",
  openExternalUrl: "alfred:workspace:open-external-url",
  openExternalTerminal: "alfred:workspace:open-external-terminal",
  imageThumbnail: "alfred:workspace:image-thumbnail",
  quickLookImage: "alfred:workspace:quick-look-image",
  revealPath: "alfred:workspace:reveal-path",
  set: "alfred:workspace:set",
} as const;
