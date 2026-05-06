import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { TerminalApi, TerminalDataEvent, TerminalExitEvent } from "../shared/terminal-ipc.js";

const terminalChannels = {
  create: "alfred:terminal:create",
  write: "alfred:terminal:write",
  resize: "alfred:terminal:resize",
  kill: "alfred:terminal:kill",
  data: "alfred:terminal:data",
  exit: "alfred:terminal:exit",
} as const;

const terminal: TerminalApi = {
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

contextBridge.exposeInMainWorld("alfredDesktop", {
  terminal,
  version: "desktop-manual-terminal",
});
