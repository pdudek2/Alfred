import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { TerminalApi, TerminalDataEvent, TerminalExitEvent } from "../shared/terminal-ipc.js";
import type { AlfredApi } from "../shared/alfred-ipc.js";

const terminalChannels = {
  list: "alfred:terminal:list",
  create: "alfred:terminal:create",
  write: "alfred:terminal:write",
  resize: "alfred:terminal:resize",
  kill: "alfred:terminal:kill",
  data: "alfred:terminal:data",
  exit: "alfred:terminal:exit",
} as const;

const alfredChannels = {
  planClear: "alfred:plan:clear",
  planGet: "alfred:plan:get",
  planRequest: "alfred:plan:request",
  planResolve: "alfred:plan:resolve",
  planSet: "alfred:plan:set",
  runtimeStatus: "alfred:runtime:status",
} as const;

const terminal: TerminalApi = {
  list: () => ipcRenderer.invoke(terminalChannels.list) as ReturnType<TerminalApi["list"]>,
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
  resolveStagedPlan: (request) =>
    ipcRenderer.invoke(alfredChannels.planResolve, request) as ReturnType<AlfredApi["resolveStagedPlan"]>,
  clearStagedPlan: () => ipcRenderer.invoke(alfredChannels.planClear) as ReturnType<AlfredApi["clearStagedPlan"]>,
};

contextBridge.exposeInMainWorld("alfredDesktop", {
  terminal,
  alfred,
  version: "desktop-launcher-v0",
});
