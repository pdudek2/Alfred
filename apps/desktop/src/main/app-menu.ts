import type { MenuItemConstructorOptions } from "electron";

/**
 * Alfred's macOS menu, in place of Electron's default one, which names the package ("@alfred/desktop"), reloads
 * the window on Command R, remounting every terminal, and closes it on Command W, which closes a session in the
 * Deck. The developer tools stay on Option Command I.
 */
export function applicationMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: "Alfred",
      submenu: [
        { role: "about", label: "About Alfred" },
        { type: "separator" },
        { role: "hide", label: "Hide Alfred" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: "Quit Alfred" },
      ],
    },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "toggleDevTools" }] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] },
  ];
}
