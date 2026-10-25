import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";
import type { TerminalApi, TerminalDataEvent, TerminalExitEvent, TerminalWorkerRequest } from "../shared/terminal-ipc.js";
import type { AlfredApi } from "../shared/alfred-ipc.js";
import type { LayoutApi } from "../shared/layout-ipc.js";
import type { SessionsApi, SessionsChannels } from "../shared/sessions-ipc.js";
import type { DesktopStateApi, DesktopSaveStatus } from "../shared/desktop-state-ipc.js";
import type { WorkspaceApi } from "../shared/workspace-ipc.js";

const terminalChannels = {
  list: "alfred:terminal:list",
  snapshot: "alfred:terminal:snapshot",
  reconcile: "alfred:terminal:reconcile",
  prepareLaunch: "alfred:terminal:prepare-launch",
  create: "alfred:terminal:create",
  write: "alfred:terminal:write",
  resize: "alfred:terminal:resize",
  kill: "alfred:terminal:kill",
  forget: "alfred:terminal:forget",
  rename: "alfred:terminal:rename",
  codexImages: "alfred:terminal:codex-images",
  worktreeDiff: "alfred:terminal:worktree-diff",
  worktreeApply: "alfred:terminal:worktree-apply",
  data: "alfred:terminal:data",
  exit: "alfred:terminal:exit",
  workerRequest: "alfred:terminal:worker-request",
  workerReply: "alfred:terminal:worker-reply",
} as const;

/**
 * Every terminal tile subscribes to output and exits; one IPC listener per channel hands each event to all of them.
 * One listener per tile passed Node's limit of ten with a dozen sessions.
 */
function sharedSubscription<T>(channel: string): (callback: (payload: T) => void) => () => void {
  const subscribers = new Set<{ callback: (payload: T) => void }>();
  const listener = (_event: IpcRendererEvent, payload: T) => {
    for (const subscriber of [...subscribers]) subscriber.callback(payload);
  };
  return (callback) => {
    const subscriber = { callback };
    if (subscribers.size === 0) ipcRenderer.on(channel, listener);
    subscribers.add(subscriber);
    return () => {
      if (subscribers.delete(subscriber) && subscribers.size === 0) ipcRenderer.off(channel, listener);
    };
  };
}

const alfredChannels = {
  planClear: "alfred:plan:clear",
  planGet: "alfred:plan:get",
  planRequest: "alfred:plan:request",
  planResolve: "alfred:plan:resolve",
  planSessionUpdate: "alfred:plan:session:update",
  planSet: "alfred:plan:set",
  runtimeStatus: "alfred:runtime:status",
} as const;

const layoutChannels = {
  get: "alfred:layout:get",
  setWorkspaceViewState: "alfred:layout:set-workspace-view-state",
} as const;

const workspaceChannels = {
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

const sessionsChannels = {
  listExternal: "alfred:sessions:list-external",
  releaseListSnapshot: "alfred:sessions:release-list-snapshot",
  resolveExternal: "alfred:sessions:resolve-external",
  readTranscriptPage: "alfred:sessions:read-transcript-page",
  getDiagnostics: "alfred:sessions:get-diagnostics",
} as const satisfies SessionsChannels;

const desktopStateChannels = {
  getPrivacySettings: "alfred:desktop-state:get-privacy-settings",
  updatePrivacySettings: "alfred:desktop-state:update-privacy-settings",
  clearSavedTerminalData: "alfred:desktop-state:clear-saved-terminal-data",
  revealStateFile: "alfred:desktop-state:reveal-state-file",
  retrySave: "alfred:desktop-state:retry-save",
  saveStatus: "alfred:desktop-state:save-status",
} as const;

const terminal: TerminalApi = {
  list: () => ipcRenderer.invoke(terminalChannels.list) as ReturnType<TerminalApi["list"]>,
  snapshot: (request) => ipcRenderer.invoke(terminalChannels.snapshot, request) as ReturnType<TerminalApi["snapshot"]>,
  reconcile: (request) =>
    ipcRenderer.invoke(terminalChannels.reconcile, request) as ReturnType<TerminalApi["reconcile"]>,
  prepareLaunch: (request) =>
    ipcRenderer.invoke(terminalChannels.prepareLaunch, request) as ReturnType<TerminalApi["prepareLaunch"]>,
  create: (request) => ipcRenderer.invoke(terminalChannels.create, request) as ReturnType<TerminalApi["create"]>,
  write: (request) => {
    ipcRenderer.send(terminalChannels.write, request);
  },
  resize: (request) => {
    ipcRenderer.send(terminalChannels.resize, request);
  },
  kill: (request) => {
    ipcRenderer.send(terminalChannels.kill, request);
  },
  forget: (request) =>
    ipcRenderer.invoke(terminalChannels.forget, request) as ReturnType<TerminalApi["forget"]>,
  rename: (request) => ipcRenderer.invoke(terminalChannels.rename, request) as ReturnType<TerminalApi["rename"]>,
  codexImages: (request) =>
    ipcRenderer.invoke(terminalChannels.codexImages, request) as ReturnType<TerminalApi["codexImages"]>,
  worktreeDiff: (request) =>
    ipcRenderer.invoke(terminalChannels.worktreeDiff, request) as ReturnType<TerminalApi["worktreeDiff"]>,
  worktreeApply: (request) =>
    ipcRenderer.invoke(terminalChannels.worktreeApply, request) as ReturnType<TerminalApi["worktreeApply"]>,
  onData: sharedSubscription<TerminalDataEvent>(terminalChannels.data),
  onExit: sharedSubscription<TerminalExitEvent>(terminalChannels.exit),
  onWorkerRequest: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: TerminalWorkerRequest) => {
      callback(payload);
    };

    ipcRenderer.on(terminalChannels.workerRequest, listener);
    return () => {
      ipcRenderer.off(terminalChannels.workerRequest, listener);
    };
  },
  answerWorkerRequest: (reply) => {
    ipcRenderer.send(terminalChannels.workerReply, reply);
  },
};

const alfred: AlfredApi = {
  requestPlan: (request) =>
    ipcRenderer.invoke(alfredChannels.planRequest, request) as ReturnType<AlfredApi["requestPlan"]>,
  getRuntimeStatus: () =>
    ipcRenderer.invoke(alfredChannels.runtimeStatus) as ReturnType<AlfredApi["getRuntimeStatus"]>,
  getStagedPlans: () => ipcRenderer.invoke(alfredChannels.planGet) as ReturnType<AlfredApi["getStagedPlans"]>,
  setStagedPlan: (request) =>
    ipcRenderer.invoke(alfredChannels.planSet, request) as ReturnType<AlfredApi["setStagedPlan"]>,
  updateStagedSession: (request) =>
    ipcRenderer.invoke(alfredChannels.planSessionUpdate, request) as ReturnType<AlfredApi["updateStagedSession"]>,
  resolveStagedPlan: (request) =>
    ipcRenderer.invoke(alfredChannels.planResolve, request) as ReturnType<AlfredApi["resolveStagedPlan"]>,
  clearStagedPlan: (request) => ipcRenderer.invoke(alfredChannels.planClear, request) as ReturnType<AlfredApi["clearStagedPlan"]>,
};

const layout: LayoutApi = {
  getLayouts: () => ipcRenderer.invoke(layoutChannels.get) as ReturnType<LayoutApi["getLayouts"]>,
  setWorkspaceViewState: (request) =>
    ipcRenderer.invoke(layoutChannels.setWorkspaceViewState, request) as ReturnType<LayoutApi["setWorkspaceViewState"]>,
};

const workspace: WorkspaceApi = {
  bindFolderToWorkspace: (request) =>
    ipcRenderer.invoke(workspaceChannels.bindFolder, request) as ReturnType<WorkspaceApi["bindFolderToWorkspace"]>,
  createWorkspaceFromFolder: () =>
    ipcRenderer.invoke(workspaceChannels.createFromFolder) as ReturnType<WorkspaceApi["createWorkspaceFromFolder"]>,
  getWorkspaceState: () =>
    ipcRenderer.invoke(workspaceChannels.get) as ReturnType<WorkspaceApi["getWorkspaceState"]>,
  openExternalUrl: (request) =>
    ipcRenderer.invoke(workspaceChannels.openExternalUrl, request) as ReturnType<WorkspaceApi["openExternalUrl"]>,
  openExternalTerminal: (request) =>
    ipcRenderer.invoke(workspaceChannels.openExternalTerminal, request) as ReturnType<WorkspaceApi["openExternalTerminal"]>,
  imageThumbnail: (request) =>
    ipcRenderer.invoke(workspaceChannels.imageThumbnail, request) as ReturnType<WorkspaceApi["imageThumbnail"]>,
  quickLookImage: (request) =>
    ipcRenderer.invoke(workspaceChannels.quickLookImage, request) as ReturnType<WorkspaceApi["quickLookImage"]>,
  revealPath: (request) =>
    ipcRenderer.invoke(workspaceChannels.revealPath, request) as ReturnType<WorkspaceApi["revealPath"]>,
  setWorkspaceState: (request) =>
    ipcRenderer.invoke(workspaceChannels.set, request) as ReturnType<WorkspaceApi["setWorkspaceState"]>,
};

const sessions: SessionsApi = {
  listExternalSessions: (request) =>
    ipcRenderer.invoke(sessionsChannels.listExternal, request) as ReturnType<SessionsApi["listExternalSessions"]>,
  releaseListSnapshot: (request) =>
    ipcRenderer.invoke(sessionsChannels.releaseListSnapshot, request) as ReturnType<SessionsApi["releaseListSnapshot"]>,
  resolveExternalSession: (request) =>
    ipcRenderer.invoke(sessionsChannels.resolveExternal, request) as ReturnType<SessionsApi["resolveExternalSession"]>,
  readTranscriptPage: (request) =>
    ipcRenderer.invoke(sessionsChannels.readTranscriptPage, request) as ReturnType<SessionsApi["readTranscriptPage"]>,
  getDiagnostics: () => ipcRenderer.invoke(sessionsChannels.getDiagnostics) as ReturnType<SessionsApi["getDiagnostics"]>,
};

const desktopState: DesktopStateApi = {
  getPrivacySettings: () =>
    ipcRenderer.invoke(desktopStateChannels.getPrivacySettings) as ReturnType<DesktopStateApi["getPrivacySettings"]>,
  updatePrivacySettings: (request) =>
    ipcRenderer.invoke(desktopStateChannels.updatePrivacySettings, request) as ReturnType<
      DesktopStateApi["updatePrivacySettings"]
    >,
  clearSavedTerminalData: () =>
    ipcRenderer.invoke(desktopStateChannels.clearSavedTerminalData) as ReturnType<
      DesktopStateApi["clearSavedTerminalData"]
    >,
  revealStateFile: () =>
    ipcRenderer.invoke(desktopStateChannels.revealStateFile) as ReturnType<DesktopStateApi["revealStateFile"]>,
  retrySave: () =>
    ipcRenderer.invoke(desktopStateChannels.retrySave) as ReturnType<DesktopStateApi["retrySave"]>,
  onSaveStatus: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: DesktopSaveStatus) => {
      callback(payload);
    };

    ipcRenderer.on(desktopStateChannels.saveStatus, listener);
    return () => {
      ipcRenderer.off(desktopStateChannels.saveStatus, listener);
    };
  },
};

contextBridge.exposeInMainWorld("alfredDesktop", {
  terminal,
  alfred,
  desktopState,
  layout,
  workspace,
  sessions,
  // A dropped File carries no path in the page since Electron 32; only the preload can read it.
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  version: "desktop-launcher-v0",
});
