import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { TerminalApi, TerminalDataEvent, TerminalExitEvent } from "../shared/terminal-ipc.js";
import type { AlfredApi } from "../shared/alfred-ipc.js";
import type { LayoutApi } from "../shared/layout-ipc.js";
import type { SessionIndexApi } from "../shared/session-index-ipc.js";
import type { DesktopStateApi, DesktopSaveStatus } from "../shared/desktop-state-ipc.js";
import type { WorkspaceApi } from "../shared/workspace-ipc.js";

const terminalChannels = {
  list: "alfred:terminal:list",
  snapshot: "alfred:terminal:snapshot",
  prepareLaunch: "alfred:terminal:prepare-launch",
  create: "alfred:terminal:create",
  write: "alfred:terminal:write",
  resize: "alfred:terminal:resize",
  kill: "alfred:terminal:kill",
  forget: "alfred:terminal:forget",
  rename: "alfred:terminal:rename",
  worktreeDiff: "alfred:terminal:worktree-diff",
  worktreeApply: "alfred:terminal:worktree-apply",
  data: "alfred:terminal:data",
  exit: "alfred:terminal:exit",
} as const;

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
  setWorkspace: "alfred:layout:set-workspace",
  setWorkspaceViewState: "alfred:layout:set-workspace-view-state",
} as const;

const workspaceChannels = {
  bindFolder: "alfred:workspace:bind-folder",
  createFromFolder: "alfred:workspace:create-from-folder",
  get: "alfred:workspace:get",
  openExternalUrl: "alfred:workspace:open-external-url",
  openExternalTerminal: "alfred:workspace:open-external-terminal",
  revealPath: "alfred:workspace:reveal-path",
  set: "alfred:workspace:set",
} as const;

const sessionIndexChannels = {
  listExternalCodexSessions: "alfred:session-index:list-external-codex",
} as const;

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
  forget: (request) => {
    ipcRenderer.send(terminalChannels.forget, request);
  },
  rename: (request) => ipcRenderer.invoke(terminalChannels.rename, request) as ReturnType<TerminalApi["rename"]>,
  worktreeDiff: (request) =>
    ipcRenderer.invoke(terminalChannels.worktreeDiff, request) as ReturnType<TerminalApi["worktreeDiff"]>,
  worktreeApply: (request) =>
    ipcRenderer.invoke(terminalChannels.worktreeApply, request) as ReturnType<TerminalApi["worktreeApply"]>,
  onData: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: TerminalDataEvent) => {
      callback(payload);
    };

    ipcRenderer.on(terminalChannels.data, listener);
    return () => {
      ipcRenderer.off(terminalChannels.data, listener);
    };
  },
  onExit: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: TerminalExitEvent) => {
      callback(payload);
    };

    ipcRenderer.on(terminalChannels.exit, listener);
    return () => {
      ipcRenderer.off(terminalChannels.exit, listener);
    };
  },
};

const alfred: AlfredApi = {
  requestPlan: (request) =>
    ipcRenderer.invoke(alfredChannels.planRequest, request) as ReturnType<AlfredApi["requestPlan"]>,
  getRuntimeStatus: () =>
    ipcRenderer.invoke(alfredChannels.runtimeStatus) as ReturnType<AlfredApi["getRuntimeStatus"]>,
  getStagedPlan: () => ipcRenderer.invoke(alfredChannels.planGet) as ReturnType<AlfredApi["getStagedPlan"]>,
  setStagedPlan: (request) =>
    ipcRenderer.invoke(alfredChannels.planSet, request) as ReturnType<AlfredApi["setStagedPlan"]>,
  updateStagedSession: (request) =>
    ipcRenderer.invoke(alfredChannels.planSessionUpdate, request) as ReturnType<AlfredApi["updateStagedSession"]>,
  resolveStagedPlan: (request) =>
    ipcRenderer.invoke(alfredChannels.planResolve, request) as ReturnType<AlfredApi["resolveStagedPlan"]>,
  clearStagedPlan: () => ipcRenderer.invoke(alfredChannels.planClear) as ReturnType<AlfredApi["clearStagedPlan"]>,
};

const layout: LayoutApi = {
  getLayouts: () => ipcRenderer.invoke(layoutChannels.get) as ReturnType<LayoutApi["getLayouts"]>,
  setWorkspaceLayout: (request) =>
    ipcRenderer.invoke(layoutChannels.setWorkspace, request) as ReturnType<LayoutApi["setWorkspaceLayout"]>,
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
  revealPath: (request) =>
    ipcRenderer.invoke(workspaceChannels.revealPath, request) as ReturnType<WorkspaceApi["revealPath"]>,
  setWorkspaceState: (request) =>
    ipcRenderer.invoke(workspaceChannels.set, request) as ReturnType<WorkspaceApi["setWorkspaceState"]>,
};

const sessionIndex: SessionIndexApi = {
  listExternalCodexSessions: () =>
    ipcRenderer.invoke(sessionIndexChannels.listExternalCodexSessions) as ReturnType<
      SessionIndexApi["listExternalCodexSessions"]
    >,
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
  sessionIndex,
  version: "desktop-launcher-v0",
});
