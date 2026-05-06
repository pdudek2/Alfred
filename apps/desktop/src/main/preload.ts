import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("alfredDesktop", {
  version: "desktop-shell-foundation",
});
